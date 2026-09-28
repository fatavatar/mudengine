import { describe, expect, it } from 'vitest';

import { commandsOf, fromMessages, fromMonsters, mobRuleOf } from '../megamudTables';

/* Rows as the fork's `messages.yaml` and `monsters.yaml` held them (skinny-inc, 2026-09-28). */
describe('a MegaMUD response as commands', () => {
  it('reads ^M as the end of a command, and a lone one as a bare Enter', () => {
    expect(commandsOf('^M')).toEqual(['']);
    expect(commandsOf('go hole')).toEqual(['go hole']);
    expect(commandsOf('.LOW ON LIVES!^M=x')).toEqual(['.LOW ON LIVES!', '=x']);
    expect(commandsOf('stat^M')).toEqual(['stat']);
  });

  it('refuses a pause or a random pick, which a rule cannot say', () => {
    expect(commandsOf('look^M~look^M')).toBeNull();
    expect(commandsOf('smile||wave')).toBeNull();
  });
});

describe('a Messages table as rules and effects', () => {
  const { rules, effects, dropped } = fromMessages([
    { name: 'Promo', match: 'Check out the website', response: '^M' },
    { name: 'forest sounds', match: 'The leaves begin to rustle', action: 'look' },
    { name: 'forest sounds', match: 'A twig snaps', action: 'look' },
    {
      name: 'chase (path)',
      match: '{target} steps onto the side-path.',
      response: 'go path',
      chase: true
    },
    { name: 'off', match: 'Something', response: 'x', enabled: false },
    {
      name: 'fear',
      match: 'You are afraid',
      endsWith: 'The effects of fear wear off',
      effects: ['held']
    },
    { name: 'weakness', match: 'You feel weak', endsWith: 'You feel stronger', action: 'wait' },
    {
      name: 'sleep',
      match: 'You are lulled to sleep',
      endsWith: 'You awaken',
      effects: ['no-attack']
    },
    {
      name: 'acid rain',
      match: 'You are covered in acid',
      endsWith: 'The acid dries up',
      effects: ['losing-hp']
    },
    { name: 'blizzard', match: '{target} is frozen', endsWith: 'The ice melts', effects: ['held'] },
    { name: 'desert damage', match: 'You suffer in the desert heat', action: 'run' },
    { name: 'acid hits', match: 'Acid sears {target} for {dmg} damage!', endsWith: '' }
  ]);

  it('makes a response or a look a line rule, names unique, a chase or a disabled row switched off', () => {
    expect(rules).toEqual([
      { name: 'Promo', when: { line: 'Check out the website' }, then: '' },
      { name: 'forest sounds', when: { line: 'The leaves begin to rustle' }, then: '' },
      { name: 'forest sounds 2', when: { line: 'A twig snaps' }, then: '' },
      {
        name: 'chase (path)',
        enabled: false,
        when: { line: '{target} steps onto the side-path.' },
        then: 'go path'
      },
      { name: 'off', enabled: false, when: { line: 'Something' }, then: 'x' }
    ]);
  });

  it('makes a lasting row an effect, `wait` and "cannot attack" meaning held', () => {
    expect(effects).toEqual([
      {
        name: 'fear',
        starts: 'You are afraid',
        ends: 'The effects of fear wear off',
        means: ['held']
      },
      { name: 'weakness', starts: 'You feel weak', ends: 'You feel stronger', means: ['held'] },
      { name: 'sleep', starts: 'You are lulled to sleep', ends: 'You awaken', means: ['held'] },
      { name: 'acid rain', starts: 'You are covered in acid', ends: 'The acid dries up', means: [] }
    ]);
  });

  it('names what it cannot carry, and carries nothing for an inert row', () => {
    expect(dropped).toEqual([
      { name: 'blizzard', why: 'names-somebody' },
      { name: 'desert damage', why: 'run' }
    ]);
  });
});

describe('a Monsters table as monster rules', () => {
  it('reads a relationship as a stance, and anything else as a band with its spell', () => {
    expect(mobRuleOf({ mob: 'gnome inventor', relationship: 'friend', priority: 'high' })).toEqual({
      mob: 'gnome inventor',
      treat: 'friend'
    });
    expect(mobRuleOf({ mob: 'hooded man', relationship: 'avoid' })).toEqual({
      mob: 'hooded man',
      treat: 'never'
    });
    expect(
      mobRuleOf({
        mob: 'storm giant king',
        relationship: 'enemy',
        notHostile: true,
        attack: { spell: 'srip', max: 0 }
      })
    ).toEqual({
      mob: 'storm giant king',
      treat: 'default',
      cast: { spell: 'srip', times: 0 },
      notHostile: true
    });
    expect(mobRuleOf({ mob: 'mind flayer', priority: 'high' })).toEqual({
      mob: 'mind flayer',
      treat: 'high'
    });
  });

  it('keeps no rule for a row that says nothing, and names a pre-attack spell it cannot carry', () => {
    expect(mobRuleOf({ mob: 'rat' })).toBeNull();
    expect(
      fromMonsters([{ mob: 'orc', priority: 'low', preAttack: { spell: 'blind', max: 1 } }])
    ).toEqual({
      rules: [{ mob: 'orc', treat: 'low' }],
      dropped: [{ name: 'orc', why: 'pre-attack' }]
    });
  });
});
