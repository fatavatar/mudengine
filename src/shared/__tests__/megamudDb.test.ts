import { describe, expect, it } from 'vitest';

import { isMdb2, readMdb2, readMegaMudMonsters } from '../megamudDb';

/*
 * A MegaMUD database built the way `megamud.exe` lays one out (see the
 * module's own notes): a header page, then 1 KB pages, each opening with a
 * 12-byte header and holding records of `len, type, key\0, 00 00 00 00 80,
 * body`. Nothing here is copied from a real file — the fixture is written
 * from the layout, so a misread offset in the reader fails it.
 */
const PAGE = 1024;

interface MonsterFixture {
  id: number;
  name: string;
  flags?: number;
  relationship?: number;
  pre?: string;
  attack?: string;
  preMax?: number;
  attackMax?: number;
}

/** The 211-byte record the monster loader reads. */
function monsterBody(m: MonsterFixture): Uint8Array {
  const body = new Uint8Array(211);
  const view = new DataView(body.buffer);
  view.setUint16(0x00, m.id, true);
  body.set(ascii(m.name), 0x02);
  view.setUint32(0x21, m.flags ?? 0, true);
  body[0x25] = m.relationship ?? 4;
  if (m.pre) body.set(ascii(m.pre), 0x26);
  if (m.attack) body.set(ascii(m.attack), 0x2b);
  view.setInt16(0x30, m.preMax ?? 0, true);
  view.setInt16(0x32, m.attackMax ?? 0, true);
  return body;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

/** One record: length byte, type, key, the lead, the body. */
function record(key: string, body: Uint8Array): Uint8Array {
  const inner = [1, ...ascii(key), 0, 0, 0, 0, 0, 0x80, ...body];
  return Uint8Array.from([inner.length, ...inner]);
}

function page(level: number, records: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(PAGE);
  const view = new DataView(out.buffer);
  view.setUint16(0, level, true);
  view.setUint16(2, records.length, true);
  let at = 12;
  for (const one of records) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

function file(...pages: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(PAGE);
  header.set(ascii('MDB2'), 0);
  const out = new Uint8Array(PAGE * (pages.length + 1));
  out.set(header, 0);
  pages.forEach((one, index) => out.set(one, PAGE * (index + 1)));
  return out;
}

describe('the MDB2 container', () => {
  it('knows its own signature', () => {
    expect(isMdb2(file(page(0, [])))).toBe(true);
    expect(isMdb2(new Uint8Array(4096))).toBe(false);
  });

  it('reads every leaf record and skips the index pages above them', () => {
    const bytes = file(
      page(0, [
        record('1', monsterBody({ id: 1, name: 'giant rat' })),
        record('10', monsterBody({ id: 10, name: 'kobold thief' }))
      ]),
      // An index page: the same keys, pointing at pages. Never records.
      page(1, [record('1', new Uint8Array(6))]),
      page(0, [record('2', monsterBody({ id: 2, name: 'lashworm' }))])
    );
    expect(readMdb2(bytes).map((one) => one.key)).toEqual(['1', '10', '2']);
  });

  /* The length byte is the record's size less one — a 16-bit reading of it
     was the earlier misreading this layout corrects. */
  it('steps from record to record by the length byte', () => {
    const bytes = file(
      page(0, [
        record('7', monsterBody({ id: 7, name: 'orc rogue' })),
        record('8', monsterBody({ id: 8, name: 'orc slave' }))
      ])
    );
    const [first, second] = readMdb2(bytes);
    expect(first?.body.length).toBe(211);
    expect(second?.key).toBe('8');
  });
});

describe('Monsters.md', () => {
  const read = (m: MonsterFixture) =>
    readMegaMudMonsters(file(page(0, [record(String(m.id), monsterBody(m))])))[0];

  it('says nothing about a plain enemy at normal priority', () => {
    expect(read({ id: 1, name: 'giant rat' })?.rule).toEqual({ mob: 'giant rat' });
  });

  it('reads each relationship', () => {
    expect(read({ id: 1, name: 'shopkeeper', relationship: 2 })?.rule.relationship).toBe('friend');
    expect(read({ id: 1, name: 'kobold', relationship: 3 })?.rule.relationship).toBe('avoid');
    expect(read({ id: 1, name: 'ooze', relationship: 5 })?.rule.relationship).toBe('escape');
    expect(read({ id: 1, name: 'stalker', relationship: 6 })?.rule.relationship).toBe('hangup');
    // MegaMUD's Unknown is an unlisted monster, as Enemy is.
    expect(read({ id: 1, name: 'thing', relationship: 0 })?.rule.relationship).toBeUndefined();
  });

  it('reads the priority nibble and the flags', () => {
    const boss = read({ id: 1, name: 'dark bishop', flags: 0x40 | 0x400 | 0x08 });
    expect(boss?.rule).toEqual({ mob: 'dark bishop', priority: 'high' });
    expect(boss?.findFirst).toBe(true);
    expect(read({ id: 1, name: 'a', flags: 0x80 })?.rule.priority).toBe('first');
    expect(read({ id: 1, name: 'a', flags: 0x20 })?.rule.priority).toBe('low');
    expect(read({ id: 1, name: 'a', flags: 0x10 })?.rule.priority).toBe('last');
    expect(read({ id: 1, name: 'golem', flags: 0x200 | 0x100 | 0x800 })?.rule).toEqual({
      mob: 'golem',
      notHostile: true,
      noBackstab: true,
      stopToKill: true
    });
  });

  it('reads the two spells and their caps', () => {
    const lich = read({
      id: 9,
      name: 'lich',
      pre: 'dspl',
      attack: 'turn',
      preMax: 1,
      attackMax: 3
    });
    expect(lich?.rule.preAttack).toEqual({ spell: 'dspl', max: 1 });
    expect(lich?.rule.attack).toEqual({ spell: 'turn', max: 3 });
  });

  it('keys the name the way the room is keyed', () => {
    expect(read({ id: 3, name: 'The Gnome' })?.rule.mob).toBe('gnome');
    expect(read({ id: 3, name: 'The Gnome' })?.name).toBe('The Gnome');
  });
});
