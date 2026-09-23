import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CastRound } from '../castRound';

/*
 * One heal, blessing or cure a round (skinny, 2026-09-23): `c mahe` then
 * `c ritu` in one round answered `You have already cast a spell this round!`,
 * and the refusal switched the fight off.
 */
describe('the one cast a round allows', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes on a cast mid-fight and opens on the next round’s first blow', () => {
    const round = new CastRound();
    round.noteBlow();
    expect(round.mayCast()).toBe(true);
    round.noteCast();
    expect(round.mayCast()).toBe(false);
    // The rest of this round's burst is the same round.
    vi.advanceTimersByTime(100);
    round.noteBlow();
    expect(round.mayCast()).toBe(false);
    // Five seconds on, the next round.
    vi.advanceTimersByTime(4_900);
    round.noteBlow();
    expect(round.mayCast()).toBe(true);
  });

  /*
   * Out of a fight as well: a heal in the round a fight ended and a blessing
   * a second and a half later were refused the same way (2026-09-23). With no
   * blows to mark the round, the gate lets go once longer than one has passed.
   */
  it('lets go when no round is seen, a round’s length after the cast', () => {
    const round = new CastRound();
    round.noteCast();
    expect(round.mayCast()).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(round.mayCast()).toBe(false);
    vi.advanceTimersByTime(4_500);
    expect(round.mayCast()).toBe(true);
  });
});
