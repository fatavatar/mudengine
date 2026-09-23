/**
 * One heal, blessing or cure per round, the server's rule mid-fight.
 *
 * Captured on skinny, 2026-09-23 (`logs/2026-09-23_18-57-40_skinny`): `c mahe`
 * then `c ritu` in one round answered `You have already cast a spell this
 * round!` — and the refusal switched combat off all the same, so the fight
 * lost the next round as well. Three times in four minutes, each a heal
 * followed by a blessing a second or two later. The attack spell the fight
 * is engaged with does not count: `c mahe` then `c fury giant war dog` in one
 * round both went through.
 *
 * So the modules that cast between rounds — `AutoHeal`, `Blessings`, `Cures`
 * — ask this before proposing, and tell it when one of theirs went out. A
 * round is read off the wire: the first blow after a quiet gap
 * (`tuning.spells.roundGapMs`), which is the burst the server prints on its
 * tick. Where no blow says a round began — out of a fight, or a fight whose
 * rounds print nothing — the gate lets go after `tuning.spells.castRoundMs`,
 * longer than a round.
 *
 * **Out of a fight too.** The server's rounds tick whether anything is
 * fighting or not: a heal cast in the round a fight ended, and a blessing a
 * second and a half later once it had, was the same refusal (2026-09-23,
 * `c mahe` then `c ritu` with the room already empty).
 */
import { tuning } from '../app/tuning';

/** What a caster asks and says. See {@link CastRound}. */
export interface CastGate {
  /** Whether a heal, blessing or cure would be this round's only one. */
  mayCast(): boolean;
  /** One went out, or the server said this round's is spent. */
  noteCast(): void;
}

/** A gate that never closes: every module's default, and every test's. */
export const OPEN_GATE: CastGate = { mayCast: () => true, noteCast: () => {} };

export class CastRound implements CastGate {
  private castAt: number | null = null;
  private roundAt = 0;
  private lastBlowAt = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** A blow either way: the first after a quiet gap is a new round. */
  noteBlow(): void {
    const at = this.now();
    if (at - this.lastBlowAt >= tuning().spells.roundGapMs) this.roundAt = at;
    this.lastBlowAt = at;
  }

  noteCast(): void {
    this.castAt = this.now();
  }

  mayCast(): boolean {
    if (this.castAt === null) return true;
    /*
     * A round that began *well after* the cast, not merely after it: the send
     * is not when the server reads it. `c hesh` went out, the dogs' round
     * printed 72ms later, and the server echoed the cast 290ms after the send
     * — the round had begun before it arrived, so it was that round's cast,
     * and the `c mahe` the round's blows let through was refused (2026-09-23).
     */
    if (this.roundAt - this.castAt >= tuning().spells.roundGapMs) return true;
    return this.now() - this.castAt >= tuning().spells.castRoundMs;
  }

  reset(): void {
    this.castAt = null;
    this.roundAt = 0;
    this.lastBlowAt = 0;
  }
}
