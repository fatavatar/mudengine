#!/usr/bin/env python3
"""
megamud.exe reading tools (MegaMUD 2.1, Mudrev build). Needs pefile + capstone.

  mm.py dis   <start> <end>      disassemble, annotating imports and strings
  mm.py str   <text> [...]       where a string lives and which code pushes it
  mm.py field <offset> [...]     every instruction touching [reg + offset]
                                 (offsets into the session struct, e.g. e208)
  mm.py fn    <address> [...]    the function an address belongs to
  mm.py ini   <start> <end>      INI key -> struct offset, from a loader range

Addresses and offsets are hex without 0x. The exe is read in memory out of
"MegaMMUD v2.1 (Mudrev).zip" in the repository root (MEGAMUD_ZIP overrides),
so no copy of it is written anywhere.
"""
import os, re, struct, sys, zipfile
import capstone, pefile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
ZIP = os.environ.get('MEGAMUD_ZIP', os.path.join(ROOT, 'MegaMMUD v2.1 (Mudrev).zip'))
with zipfile.ZipFile(ZIP) as archive:
    name = next(n for n in archive.namelist() if n.lower().endswith('megamud.exe'))
    pe = pefile.PE(data=archive.read(name))
base = pe.OPTIONAL_HEADER.ImageBase
text = [s for s in pe.sections if s.Name.startswith(b'.text')][0]
code = text.get_data()
va0 = base + text.VirtualAddress
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
imports = {i.address: i.name.decode() for e in pe.DIRECTORY_ENTRY_IMPORT for i in e.imports if i.name}


def string_at(va):
    for sec in pe.sections:
        lo = base + sec.VirtualAddress
        if lo <= va < lo + sec.Misc_VirtualSize and not sec.Name.startswith(b'.text'):
            data = sec.get_data()[va - lo:va - lo + 80]
            end = data.find(b'\0')
            if end > 2 and all(32 <= c < 127 or c in (9, 10, 13) for c in data[:end]):
                return data[:end].decode('latin1')
    return None


def dis(start, end):
    for ins in md.disasm(code[start - va0:end - va0], start):
        line = f'{ins.address:08x} {ins.mnemonic} {ins.op_str}'
        for tok in re.findall(r'0x[0-9a-f]+', ins.op_str):
            value = int(tok, 16)
            if value in imports:
                line += f'   ; {imports[value]}'
            else:
                found = string_at(value)
                if found:
                    line += f'   ; {found!r}'
        print(line)


def find_string(needle):
    raw = needle.encode('latin1').decode('unicode_escape').encode('latin1') + b'\0'
    for sec in pe.sections:
        if sec.Name.startswith(b'.text'):
            continue
        data = sec.get_data()
        at = data.find(raw)
        while at >= 0:
            if at == 0 or data[at - 1] == 0:
                va = base + sec.VirtualAddress + at
                pat = struct.pack('<I', va)
                refs, i = [], code.find(pat)
                while i >= 0:
                    refs.append(hex(va0 + i - 1))
                    i = code.find(pat, i + 1)
                print(f'{needle!r} at {va:#x} used by {refs}')
            at = data.find(raw, at + 1)


def field(offset):
    pat = struct.pack('<I', offset)
    i, seen = code.find(pat), set()
    while i >= 0:
        for back in range(2, 8):
            for ins in md.disasm(code[i - back:i + 8], va0 + i - back):
                if hex(offset) in ins.op_str and ins.address not in seen and ins.address + ins.size >= va0 + i + 4:
                    seen.add(ins.address)
                    print(f'{offset:x} {ins.address:#x} {ins.mnemonic} {ins.op_str}')
                break
        i = code.find(pat, i + 1)


def function_of(address):
    at = code.rfind(b'\x55\x8b\xec', 0, address - va0)
    while at > 0 and code[at - 1] not in (0xcc, 0xc3, 0x90):
        at = code.rfind(b'\x55\x8b\xec', 0, at)
    print(f'{address:#x} is in the function at {va0 + at:#x}')


def ini(start, end):
    """
    One line per read call: the key and section it pushed, and the slot it
    fills — `lea reg, [esi + X]` pushed ahead of a text read, or
    `mov [esi + X], eax` straight after a number read.
    """
    window, last = [], None
    instructions = list(md.disasm(code[start - va0:end - va0], start))
    for n, ins in enumerate(instructions):
        if ins.mnemonic == 'call':
            words = [s for s in (string_at(int(t, 16)) for op in window for t in re.findall(r'0x[0-9a-f]+', op)) if s]
            slot = next((m.group(1) for op in window for m in [re.search(r'lea \w+, \[esi \+ (0x[0-9a-f]+)\]', op)] if m), None)
            after = instructions[n + 2] if n + 2 < len(instructions) else None
            for follow in instructions[n + 1:n + 3]:
                m = re.search(r'mov dword ptr \[esi \+ (0x[0-9a-f]+)\], eax', f'{follow.mnemonic} {follow.op_str}')
                if m:
                    slot = m.group(1)
            if len(words) >= 2:
                key, section = words[-2], words[-1]
                print(f'{section:>10} {key:<24} {slot or "?":>8}  (read by {ins.op_str})')
            window = []
            continue
        window.append(f'{ins.mnemonic} {ins.op_str}')


if __name__ == '__main__':
    verb, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    if verb == 'dis':
        dis(int(args[0], 16), int(args[1], 16))
    elif verb == 'str':
        for a in args:
            find_string(a)
    elif verb == 'field':
        for a in args:
            field(int(a, 16))
    elif verb == 'fn':
        for a in args:
            function_of(int(a, 16))
    elif verb == 'ini':
        ini(int(args[0], 16), int(args[1], 16))
    else:
        print(__doc__)
