import { describe, expect, it } from 'vitest';

import { afflictionHolding, stillFled, stillFor, type FledRoom } from '../walk';
import { EMPTY_CHARACTER, NO_AFFLICTIONS, type StatedEffect } from '../character';
import { DEFAULT_CONFIG, healthHolding, type HealthConfig } from '../config';

/*
 * The rooms an escape must not run back into, and *when* that list forgets.
 *
 * The escape ladder's `forbidden` set is what stops a character running out of
 * a lair and straight back into it. The list used to be emptied by the first
 * instant the client saw no fight, which is an instant a fight against two
 * monsters manufactures for free — `*Combat Off*` names the death of the
 * current target, and the dead leave the attacker list with the kill. Four
 * reproductions, three areas, four deaths (todo 12). The clock is the second
 * test, and this is it.
 */
describe('the rooms still too recently fled to go back into', () => {
  const fled = (room: string, at: number): FledRoom => ({ room, at });

  it('keeps a room fled inside the window', () => {
    const kept = stillFled([fled('1/3', 1_000)], 5_000, 10_000);
    expect(kept.map((entry) => entry.room)).toEqual(['1/3']);
  });

  it('forgets a room fled longer ago than the window', () => {
    expect(stillFled([fled('1/3', 1_000)], 12_000, 10_000)).toEqual([]);
  });

  /*
   * The boundary is exclusive on purpose: at exactly the window the fight that
   * was fled is as old as the client is willing to believe it could be, and
   * the room is a way out again. Stated because *forbidden for ten seconds*
   * and *forbidden for ten seconds inclusive* differ by one status line.
   */
  it('forgets a room fled exactly the window ago', () => {
    expect(stillFled([fled('1/3', 1_000)], 11_000, 10_000)).toEqual([]);
  });

  /*
   * The case the bug was: two rooms fled in one chain of escapes, and the
   * quiet tick between one monster dying and the next swinging. Both are
   * fresh, so neither is a way out — A→B→C and back into A is the same
   * mistake one link longer.
   */
  it('keeps every room of a chain of escapes while all are fresh', () => {
    const kept = stillFled([fled('1/3', 1_000), fled('1/2', 3_000)], 4_000, 10_000);
    expect(kept.map((entry) => entry.room)).toEqual(['1/3', '1/2']);
  });

  /* And forgets only the ones that have aged out, newest kept. */
  it('forgets the older room and keeps the newer', () => {
    const kept = stillFled([fled('1/3', 1_000), fled('1/2', 9_000)], 12_000, 10_000);
    expect(kept.map((entry) => entry.room)).toEqual(['1/2']);
  });

  it('is a filter, not a mutation', () => {
    const rooms = [fled('1/3', 1_000)];
    stillFled(rooms, 99_000, 10_000);
    expect(rooms).toHaveLength(1);
  });
});

describe("what the realm's messages say stands a walk still", () => {
  const movement = { walkWhileBlind: false, walkWhilePoisoned: false, walkWhileConfused: false };
  const stated = (patch: Partial<StatedEffect>): StatedEffect => ({
    name: 'row',
    effects: [],
    action: 'none',
    since: 0,
    ...patch
  });

  it('holds for confusion, unless the player said to walk on', () => {
    const confused = [stated({ effects: ['confused'] })];
    expect(afflictionHolding(NO_AFFLICTIONS, movement, confused)).toBe('condition');
    expect(
      afflictionHolding(NO_AFFLICTIONS, { ...movement, walkWhileConfused: true }, confused)
    ).toBeNull();
  });

  it('holds while losing hit points, and for a row that says to wait or rest', () => {
    expect(afflictionHolding(NO_AFFLICTIONS, movement, [stated({ effects: ['losing-hp'] })])).toBe(
      'condition'
    );
    expect(afflictionHolding(NO_AFFLICTIONS, movement, [stated({ action: 'wait' })])).toBe(
      'condition'
    );
    expect(afflictionHolding(NO_AFFLICTIONS, movement, [stated({ action: 'rest-hp' })])).toBe(
      'condition'
    );
  });

  it('does not hold for what is not a movement matter', () => {
    expect(
      afflictionHolding(NO_AFFLICTIONS, movement, [stated({ effects: ['hp-regen', 'no-attack'] })])
    ).toBeNull();
  });

  it("names the wire's own affliction ahead of a stated condition", () => {
    expect(
      afflictionHolding({ ...NO_AFFLICTIONS, held: 'yes' }, movement, [
        stated({ effects: ['confused'] })
      ])
    ).toBe('held');
  });
});

/*
 * What would stand a character still, on the walker's and the loop's own
 * predicates, for a follower's `@wait` (2026-09-25) — so a follower asks its
 * leader to stop at exactly the figures its own walk would, and walks on at
 * the same ones.
 */
describe('why a character would stand still', () => {
  const health: HealthConfig = {
    ...DEFAULT_CONFIG.automation.health,
    restBelow: 0.5,
    restTo: 0.9,
    meditateBelow: 0.3,
    meditateTo: 0.8
  };
  const config = { health, movement: DEFAULT_CONFIG.automation.movement };
  const at = (hp: number, mana: number | null = null, over = {}) => ({
    ...EMPTY_CHARACTER,
    ...over,
    vitals: { ...EMPTY_CHARACTER.vitals, hp, hpMax: 100, mana, manaMax: mana === null ? null : 100 }
  });

  it('is health under the floor, and stays so to the ceiling', () => {
    expect(stillFor(at(40), config, null, 0.1)).toBe('health');
    expect(stillFor(at(70), config, null, 0.1)).toBeNull();
    expect(stillFor(at(70), config, 'health', 0.1)).toBe('health');
    expect(stillFor(at(95), config, 'health', 0.1)).toBeNull();
  });

  it('is mana on the same terms', () => {
    expect(stillFor(at(100, 20), config, null, 0.1)).toBe('mana');
    expect(stillFor(at(100, 50), config, 'mana', 0.1)).toBe('mana');
    expect(stillFor(at(100, 85), config, 'mana', 0.1)).toBeNull();
  });

  // A ceiling carries on only what was stopped for: held, then freed at 70%,
  // walks on, as the walker's one hold slot does.
  it('reads a ceiling only for the reason being waited on', () => {
    expect(stillFor(at(70), config, 'held', 0.1)).toBeNull();
  });

  it('puts what the server stated first', () => {
    const held = at(40, null, { afflictions: { ...NO_AFFLICTIONS, held: 'yes' } });
    expect(stillFor(held, config, null, 0.1)).toBe('held');
  });

  it('is not sitting down', () => {
    const sitting = at(70);
    sitting.vitals = { ...sitting.vitals, resting: true };
    expect(stillFor(sitting, config, null, 0.1)).toBeNull();
  });

  /* `restTo` 0 is the single sit-down, not a zero-width band: the margin is. */
  it('walks on a margin above the floor where there is no ceiling', () => {
    const uncapped = { ...health, restTo: 0 };
    expect(healthHolding(uncapped, 55, 100, true, 0.1)).toBe(true);
    expect(healthHolding(uncapped, 65, 100, true, 0.1)).toBe(false);
  });

  it('holds for nothing unknown, and for nothing with the floor off', () => {
    expect(healthHolding(health, null, 100, false, 0.1)).toBe(false);
    expect(healthHolding(health, 40, null, false, 0.1)).toBe(false);
    expect(healthHolding({ ...health, restBelow: 0 }, 1, 100, true, 0.1)).toBe(false);
  });
});
