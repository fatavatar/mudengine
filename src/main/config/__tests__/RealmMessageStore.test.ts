import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { homeAt, type Home } from '../../app/home';
import { RealmMessageStore } from '../RealmMessageStore';
import { blankTrigger } from '../../../shared/messageTriggers';

let root: string;
let home: Home;
let store: RealmMessageStore;
let errors: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-messages-'));
  home = homeAt(root);
  fs.mkdirSync(home.server('paradigm').dir, { recursive: true });
  errors = [];
  store = new RealmMessageStore(home, (message) => errors.push(message));
});

afterEach(() => {
  store.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

const confusion = {
  ...blankTrigger(),
  name: 'confusion',
  match: 'You are confused',
  endsWith: 'The effects of confusion wear off',
  effects: ['confused' as const],
  action: 'wait' as const
};

describe('RealmMessageStore', () => {
  it('reads a realm with no file as an empty table', () => {
    expect(store.forServer('paradigm')).toEqual({ source: null, triggers: [] });
  });

  it('writes a table beside the realm and reads it back', () => {
    const source = { file: 'Messages.md', importedAt: '2026-09-22T12:00:00.000Z' };
    const result = store.write('paradigm', { source, triggers: [confusion] });
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(path.join(home.server('paradigm').dir, 'messages.yaml'))).toBe(true);
    expect(store.forServer('paradigm')).toEqual({ source, triggers: [confusion] });
  });

  it('keeps a comment somebody wrote in the file across a save', () => {
    store.write('paradigm', { source: null, triggers: [confusion] });
    const file = store.file('paradigm');
    fs.writeFileSync(file, `# mine, do not lose\n${fs.readFileSync(file, 'utf8')}`);
    store.write('paradigm', { source: null, triggers: [] });
    expect(fs.readFileSync(file, 'utf8')).toContain('# mine, do not lose');
  });

  it('says so, once, when the file does not parse, and answers nothing', () => {
    fs.writeFileSync(store.file('paradigm'), 'messages: [unclosed\n');
    expect(store.forServer('paradigm').triggers).toEqual([]);
    expect(store.forServer('paradigm').triggers).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('announces a write so sessions on the realm pick it up', () => {
    let changes = 0;
    store.on('change', () => (changes += 1));
    store.write('paradigm', { source: null, triggers: [confusion] });
    expect(changes).toBe(1);
  });
});
