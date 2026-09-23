import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { homeAt, type Home } from '../../app/home';
import { RealmMonsterStore } from '../RealmMonsterStore';
import type { MonsterRule } from '../../../shared/monsterRules';

let root: string;
let home: Home;
let store: RealmMonsterStore;
let errors: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-monsters-'));
  home = homeAt(root);
  fs.mkdirSync(home.server('paradigm').dir, { recursive: true });
  errors = [];
  store = new RealmMonsterStore(home, (message) => errors.push(message));
});

afterEach(() => {
  store.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

const ooze: MonsterRule = { mob: 'gigantic black ooze', relationship: 'escape', priority: 'high' };
const lich: MonsterRule = {
  mob: 'lich',
  noBackstab: true,
  preAttack: { spell: 'dspl', max: 1 },
  attack: { spell: 'turn', max: 0 }
};

describe('RealmMonsterStore', () => {
  it('reads a realm with no file as an empty table', () => {
    expect(store.forServer('paradigm')).toEqual({ source: null, monsters: [] });
  });

  it('writes a table beside the realm and reads it back', () => {
    const source = { file: 'Monsters.md', importedAt: '2026-09-23T12:00:00.000Z' };
    expect(store.write('paradigm', { source, monsters: [ooze, lich] })).toEqual({ ok: true });
    expect(fs.existsSync(path.join(home.server('paradigm').dir, 'monsters.yaml'))).toBe(true);
    expect(store.forServer('paradigm')).toEqual({ source, monsters: [ooze, lich] });
  });

  /* A spell with no cap is the bare word, which is what a person would type. */
  it('writes an uncapped spell as its bare name', () => {
    store.write('paradigm', { source: null, monsters: [lich] });
    const text = fs.readFileSync(store.file('paradigm'), 'utf8');
    expect(text).toMatch(/attack: turn\n/);
    expect(text).toMatch(/spell: dspl/);
  });

  it('says so, once, when the file does not parse, and reads as empty', () => {
    fs.writeFileSync(store.file('paradigm'), 'monsters: [unclosed\n');
    expect(store.forServer('paradigm').monsters).toEqual([]);
    expect(store.forServer('paradigm').monsters).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
