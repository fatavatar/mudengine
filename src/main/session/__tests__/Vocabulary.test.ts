import { describe, expect, it, vi } from 'vitest';
import { Vocabulary } from '../Vocabulary';
import { UNSTATED_REALM_WORDS } from '../../../shared/profiles';

/* What a line of the realm's tells the vocabulary: a command thrown away, and how. */
describe('a command the realm threw away', () => {
  const vocabulary = (fumbles: string[], confusing: number[] = []) =>
    new Vocabulary(
      {
        tracker: { useFamily: vi.fn() },
        errands: { forgetFitness: vi.fn() },
        world: {
          info: {} as never,
          spellsByMessage: () => new Map(confusing.map((row) => [row, ['confusion']]))
        },
        words: () => ({ ...UNSTATED_REALM_WORDS, fumbles })
      },
      { locateRefused: vi.fn(), notice: vi.fn() }
    );

  it('reads a confusion row as confusion, and the realm’s own sentence as stated', () => {
    const words = vocabulary(['You trigger the trap'], [72]);
    expect(words.fumbled('You retch uncontrollably!', 72)).toBe('confusion');
    expect(words.fumbled('You trigger the trap, and a spear shoots out!', null)).toBe('stated');
    expect(words.fumbled('You disarm the trap.', null)).toBeNull();
  });
});
