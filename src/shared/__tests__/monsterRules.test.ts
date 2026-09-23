import { describe, expect, it } from 'vitest';

import {
  asMonsterRule,
  asMonsterRules,
  mergeMonsterRules,
  relationshipOf,
  ruleFor,
  withRealmMonsters,
  type MonsterRule
} from '../monsterRules';

describe('reading a row', () => {
  it('keeps what it knows and drops the rest of the field, not the row', () => {
    expect(
      asMonsterRule({
        mob: 'The Giant Rat',
        relationship: 'nemesis',
        priority: 'high',
        notHostile: true,
        attack: { spell: ' mmis ', max: 2 },
        preAttack: 'dspl'
      })
    ).toEqual({
      mob: 'giant rat',
      priority: 'high',
      notHostile: true,
      attack: { spell: 'mmis', max: 2 },
      preAttack: { spell: 'dspl', max: 0 }
    });
  });

  it('drops a row with no monster, and a second row for the same one', () => {
    expect(asMonsterRules([{ relationship: 'friend' }, { mob: 'rat' }, { mob: 'Rat' }])).toEqual([
      { mob: 'rat' }
    ]);
  });
});

/*
 * The shaman's case (2026-09-23): the realm marks a monster Flee, a
 * character names only a spell for it, and both hold.
 */
describe('laying a character over its realm', () => {
  const realm: MonsterRule[] = [
    { mob: 'gigantic black ooze', relationship: 'escape', priority: 'high' },
    { mob: 'shopkeeper', relationship: 'friend' }
  ];

  it('changes only what the narrower row states', () => {
    const merged = mergeMonsterRules(realm, [
      { mob: 'gigantic black ooze', attack: { spell: 'mmis', max: 0 } }
    ]);
    expect(merged).toContainEqual({
      mob: 'gigantic black ooze',
      relationship: 'escape',
      priority: 'high',
      attack: { spell: 'mmis', max: 0 }
    });
    expect(merged).toContainEqual({ mob: 'shopkeeper', relationship: 'friend' });
  });

  it('lets the narrower row change a field the realm set', () => {
    const merged = mergeMonsterRules(realm, [{ mob: 'shopkeeper', relationship: 'enemy' }]);
    expect(relationshipOf(merged, 'shopkeeper')).toBe('enemy');
  });

  it('merges into the combat settings, and leaves them alone with no realm table', () => {
    const combat = { monsters: [{ mob: 'rat', relationship: 'friend' as const }] };
    expect(withRealmMonsters(combat, [])).toBe(combat);
    expect(withRealmMonsters(combat, realm).monsters).toHaveLength(3);
  });
});

describe('finding the row for a monster', () => {
  const rules: MonsterRule[] = [
    { mob: 'bishop', relationship: 'avoid' },
    { mob: 'dark bishop', relationship: 'escape' },
    { mob: 'rat', relationship: 'friend' }
  ];

  it('takes the exact name first', () => {
    expect(ruleFor(rules, 'The Bishop')?.mob).toBe('bishop');
  });

  /* What MegaMUD's Find first flag arranged by hand. */
  it('takes the longest part of the name that fits', () => {
    expect(ruleFor(rules, 'evil dark bishop')?.mob).toBe('dark bishop');
  });

  it('matches whole words only', () => {
    expect(ruleFor(rules, 'giant rat')?.mob).toBe('rat');
    expect(ruleFor(rules, 'wererat')).toBeNull();
    expect(ruleFor(rules, 'pirate')).toBeNull();
  });

  /*
   * Reported 2026-09-23: an imported `rogue` row, marked Avoid, reached
   * `large orc rogue` and `fierce orc rogue`, and a character walked past both.
   * The realm names `orc rogue`, so that is the monster; `rogue` is another.
   */
  describe('with the realm to say what a monster is called', () => {
    const table: MonsterRule[] = [
      { mob: 'rogue', relationship: 'avoid' },
      { mob: 'guardsman', relationship: 'friend' }
    ];
    const realm = new Set(['rogue', 'orc rogue', 'guardsman']);
    const known = (key: string): boolean => realm.has(key);

    it('does not let a shorter monster’s row reach a longer monster', () => {
      expect(ruleFor(table, 'large orc rogue', known)).toBeNull();
      expect(ruleFor(table, 'orc rogue', known)).toBeNull();
      expect(relationshipOf(table, 'fierce orc rogue', known)).toBe('enemy');
    });

    it('still reaches through a modifier to the monster the realm names', () => {
      expect(ruleFor(table, 'nasty guardsman', known)?.mob).toBe('guardsman');
      expect(ruleFor(table, 'fierce rogue', known)?.mob).toBe('rogue');
    });

    it('falls back to the table alone for a name the realm does not carry', () => {
      expect(ruleFor(table, 'large sea rogue', known)?.mob).toBe('rogue');
    });
  });

  it('calls a monster nothing names an enemy', () => {
    expect(relationshipOf(rules, 'orc')).toBe('enemy');
    expect(relationshipOf([], 'orc')).toBe('enemy');
  });
});
