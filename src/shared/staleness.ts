/**
 * What a sentence off the wire made out of date, and the command that says it
 * again.
 *
 * The client holds facts a command established and the server's own broadcasts
 * maintain — the standing shape everywhere here. Some sentences maintain
 * nothing and instead **invalidate**: they say a number the client is holding
 * has just changed without saying what it changed to. `Welcome to level 7!` is
 * the plain case — the experience needed for the next level, the maximum hit
 * points and the mana are all different from that line onward, and nothing in
 * the stream will ever correct them, so *Exp. needed* and *Will level in* read
 * against the previous level for the rest of the session.
 *
 * So this is the third column of that table: **what a sentence made stale**,
 * declared as data rather than as a chain of `if`s beside the code that asks.
 * `Routines` reads it and proposes the refresh to `CommandQueue`; nothing here
 * sends anything, and nothing here decides *whether* to — a fact being stale
 * is a fact, and asking is an action.
 *
 * In `shared/` and dependency-free, like the rest: the block vocabulary is
 * shared, and a table keyed by it belongs beside the vocabulary rather than
 * inside one process.
 */
import type { BlockType } from './blocks';
import type { CharacterState } from './character';

/**
 * A fact the client holds that exactly one command re-establishes.
 *
 * Closed, and the union has two halves that move together — the word and the
 * command it names in `REFRESH` — which `src/shared/__tests__/staleness.test.ts`
 * asserts, for the reason `GUARD_FIELDS` records: a member in the type and not
 * in the table type-checks and then refreshes nothing.
 *
 * The spellbook is deliberately **not** here. Its command is `spells` or
 * `powers` depending on the class and the client learns which from the
 * server's own refusal, so there is no fixed command to name; `Routines` keeps
 * that one where the correction it came from lives.
 */
export type StaleFact =
  /** `st` — the maxima, the six attributes, the skills, `Lives/CP`. */
  | 'sheet'
  /** `exp` — experience made, and how much is needed for the next level. */
  | 'experience'
  /** `i` — what is carried, and the purse `Wealth:` states. */
  | 'pack';

/**
 * The command that says each fact again, and the intent it coalesces onto.
 *
 * The keys are the ones the entry probe already builds (`probe:${command}`),
 * so a refresh and an entry probe for the same command are **one** intent
 * rather than two spellings of it — coalesce by intent is the whole rule, and
 * two `st`s queued a second apart is a command spent to be told what the first
 * one is already on its way back with.
 */
export const REFRESH: Record<StaleFact, { command: string; coalesceKey: string }> = {
  sheet: { command: 'st', coalesceKey: 'probe:st' },
  experience: { command: 'exp', coalesceKey: 'probe:exp' },
  pack: { command: 'i', coalesceKey: 'probe:i' }
};

/**
 * Which facts each sentence invalidated.
 *
 * Only sentences that state a change **and not its result**. A listing is not
 * here: it *is* the answer. Nor is anything the maintained-listing shape
 * already keeps true for free — a coin picked up counts itself up, and asking
 * `i` for it would spend from the budget walking and fighting spend from.
 *
 * - **`user-levels`** (`Welcome to level 7!`) — the sheet, because the maximum
 *   hit points and mana are rolled on the level, and the experience, because
 *   the figure for the *next* level is a different number and this realm's
 *   status line carries no `Need=` to maintain it.
 * - **`user-trains`** — the same two, plus the **pack**: the sentence states a
 *   price handed over (`You hand over 250 copper farthings…`), so the purse
 *   `Wealth:` and the copper count are both wrong from that line, and nothing
 *   else says so. Both sentences rather than one, because they are two facts —
 *   a train that was refused prints neither, and a level reached by a kill
 *   prints only the welcome.
 * - **`user-stats-assigned`** — the sheet, and only the sheet. It is the exit
 *   from the stat-assignment screen, which rewrites six attributes and
 *   recalculates the maximum hit points (`AssignStatsState`, `SetStats` then
 *   `BaseMaxHP = CalcMaxHP()`); it spends character points and no coin, and
 *   the experience curve is untouched.
 */
export const STALE_AFTER: Partial<Record<BlockType, readonly StaleFact[]>> = {
  'user-levels': ['sheet', 'experience'],
  'user-trains': ['sheet', 'experience', 'pack'],
  'user-stats-assigned': ['sheet']
};

/** What this sentence made stale — empty for the ones that made nothing stale. */
export function staleAfter(type: BlockType): readonly StaleFact[] {
  return STALE_AFTER[type] ?? [];
}

/**
 * How each fact shows it has been read, and the block that answers its command.
 *
 * The other half of the table: a fact can be out of date because a sentence
 * said so (`STALE_AFTER`), or because it was never read at all. The entry
 * probe asks for all of them on the way in, and the answer can be lost —
 * skinny entered the realm on the ground on 2026-09-25, the entry probe's `st`
 * never went out, and every health figure read *unknown, so not low* while he
 * walked a route at 17%. A confused character's fumble, a refusal and a
 * half-typed line lose it the same way.
 *
 * `read` is the state's own word, never a memory of having asked. `answeredBy`
 * is the listing the command prints, so a realm that answered without the
 * figure — a sheet with no hit points on it — is not asked again for ever.
 */
export const READ: Record<
  StaleFact,
  {
    read(state: Pick<CharacterState, 'vitals' | 'progress' | 'inventory'>): boolean;
    answeredBy: BlockType;
  }
> = {
  // The maxima are the sheet's alone on a realm whose prompt carries none.
  sheet: { read: (state) => state.vitals.hpMax !== null, answeredBy: 'player-status' },
  experience: { read: (state) => state.progress.expNeeded !== null, answeredBy: 'user-experience' },
  // *Carrying nothing* and *nobody has looked* are different; `listedAt` says which.
  pack: { read: (state) => state.inventory.listedAt !== null, answeredBy: 'user-inventory' }
};

/**
 * The facts nothing can be trusted without, asked for until read.
 *
 * The sheet, because every health decision — a rest, a walk's hold, `@wait`
 * — reads an unknown maximum as *not low*. The pack, because the router
 * treats an exit gated on an item as shut until a listing has said, and the
 * potions, the light and the encumbrance are read off it. Experience is not:
 * a readout wrong for a while costs nothing.
 */
export const REQUIRED: readonly StaleFact[] = ['sheet', 'pack'];

/** The required facts this state has not read yet. */
export function unread(
  state: Pick<CharacterState, 'vitals' | 'progress' | 'inventory'>
): StaleFact[] {
  return REQUIRED.filter((fact) => !READ[fact].read(state));
}
