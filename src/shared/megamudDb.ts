/**
 * MegaMUD 2.1's binary databases — `Monsters.md`, `Items.md` and the rest —
 * read (roadmap step 3, 2026-09-23).
 *
 * The layout was read out of `megamud.exe` itself: the monster loader at
 * 0x46c690, the item loader at 0x459860, and the edit dialogs (324, 316 in
 * `MegaRes.dll`) that say which offset is which field. Nothing here was
 * guessed from the bytes alone; every offset below is one the loader copies.
 *
 * **The container.** The file opens `MDB2` and is a B+tree of 1 KB pages;
 * page 0 is the header and is skipped. Every other page opens with a 12-byte
 * header — level (0 is a leaf), record count, and links this reader has no
 * use for — and then holds its records back to back: a length byte (the
 * record occupies that many bytes *plus one*, which is what an earlier read
 * of it as a 16-bit word got wrong), a type byte, the key as a decimal id
 * string ending in NUL, and the body. The body opens with four zero bytes and
 * `0x80`; what the loader reads starts after them.
 *
 * Only the leaves are read. The index pages above them repeat keys and point
 * at pages, and a file whose tree is damaged still has every record on a leaf.
 */
import type { MobPriorityBand } from './config';
import type { MonsterRule, Relationship } from './monsterRules';
import { mobKey } from './world';

const PAGE = 1024;
const PAGE_HEADER = 12;
/** The four zero bytes and the `0x80` before the loader's own record. */
const BODY_LEAD = 5;

/** One record as a leaf holds it: its key and the loader's bytes. */
export interface MdbRecord {
  key: string;
  body: Uint8Array;
}

/** Whether these bytes are an MDB2 file at all. */
export function isMdb2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PAGE * 2 &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x42 &&
    bytes[3] === 0x32
  );
}

/**
 * Every leaf record, in file order. A record that would run past its page
 * ends that page's reading rather than the file's.
 */
export function readMdb2(bytes: Uint8Array): MdbRecord[] {
  if (!isMdb2(bytes)) return [];
  const out: MdbRecord[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages = Math.floor(bytes.length / PAGE);
  for (let page = 1; page < pages; page += 1) {
    const start = page * PAGE;
    const level = view.getUint16(start, true);
    const count = view.getUint16(start + 2, true);
    if (level !== 0 || count === 0) continue;
    let at = start + PAGE_HEADER;
    const end = start + PAGE;
    for (let i = 0; i < count; i += 1) {
      if (at + 2 > end) break;
      const length = bytes[at]!;
      const next = at + length + 1;
      if (length < 2 || next > end) break;
      // `at + 1` is the type byte; the key starts after it.
      const keyStart = at + 2;
      let keyEnd = keyStart;
      while (keyEnd < next && bytes[keyEnd] !== 0) keyEnd += 1;
      const key = latin1(bytes.subarray(keyStart, keyEnd));
      const body = bytes.subarray(keyEnd + 1 + BODY_LEAD, next);
      out.push({ key, body });
      at = next;
    }
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return s;
}

/** A NUL-terminated string in a fixed field. */
function field(body: Uint8Array, offset: number, size: number): string {
  const end = Math.min(body.length, offset + size);
  let stop = offset;
  while (stop < end && body[stop] !== 0) stop += 1;
  return latin1(body.subarray(offset, stop)).trim();
}

/* ------------------------------------------------------------ monsters */

/*
 * Offsets into the loader's record (0x46c690 copies each into the struct the
 * dialog edits). 211 bytes in all; everything past 0x3a is the realm's own
 * statistics, which this client already has from the realm data.
 */
const MON = {
  id: 0x00,
  name: 0x02,
  nameSize: 31,
  flags: 0x21,
  relationship: 0x25,
  preSpell: 0x26,
  attackSpell: 0x2b,
  spellSize: 5,
  preMax: 0x30,
  attackMax: 0x32
} as const;

const FIND_FIRST = 0x08;
const NO_BACKSTAB = 0x100;
const NOT_HOSTILE = 0x200;
const STOP_TO_KILL = 0x800;

/** The relationship byte, from the value table at 0x562410. */
const RELATIONSHIP: Readonly<Record<number, Relationship>> = {
  2: 'friend',
  3: 'avoid',
  4: 'enemy',
  5: 'escape',
  6: 'hangup'
};

/** The priority nibble: 0x80 First … 0x10 Last, and none for Normal. */
const PRIORITY: Readonly<Record<number, MobPriorityBand>> = {
  0x80: 'first',
  0x40: 'high',
  0x20: 'low',
  0x10: 'last'
};

/** One monster as MegaMUD's database holds it. */
export interface MegaMudMonster {
  id: number;
  name: string;
  rule: MonsterRule;
  findFirst: boolean;
}

/**
 * Every monster in a `Monsters.md`, and what MegaMUD says about each.
 *
 * `rule` states only what differs from an unlisted monster: `enemy` and
 * MegaMUD's *Unknown* are both left out, as is the Normal band.
 */
export function readMegaMudMonsters(bytes: Uint8Array): MegaMudMonster[] {
  const out: MegaMudMonster[] = [];
  for (const record of readMdb2(bytes)) {
    const body = record.body;
    if (body.length < MON.attackMax + 2) continue;
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const name = field(body, MON.name, MON.nameSize);
    const mob = mobKey(name);
    if (mob.length === 0) continue;
    const flags = view.getUint32(MON.flags, true) & 0x3fffffff;
    const rule: MonsterRule = { mob };
    const relationship = RELATIONSHIP[body[MON.relationship]!];
    if (relationship !== undefined && relationship !== 'enemy') rule.relationship = relationship;
    const priority = PRIORITY[flags & 0xf0];
    if (priority !== undefined) rule.priority = priority;
    if (flags & NOT_HOSTILE) rule.notHostile = true;
    if (flags & NO_BACKSTAB) rule.noBackstab = true;
    if (flags & STOP_TO_KILL) rule.stopToKill = true;
    const pre = field(body, MON.preSpell, MON.spellSize);
    if (pre.length > 0) rule.preAttack = { spell: pre, max: castCount(view, MON.preMax) };
    const attack = field(body, MON.attackSpell, MON.spellSize);
    if (attack.length > 0) rule.attack = { spell: attack, max: castCount(view, MON.attackMax) };
    out.push({
      id: view.getUint16(MON.id, true),
      name,
      rule,
      findFirst: (flags & FIND_FIRST) !== 0
    });
  }
  return out;
}

function castCount(view: DataView, offset: number): number {
  const value = view.getInt16(offset, true);
  return value > 0 ? value : 0;
}
