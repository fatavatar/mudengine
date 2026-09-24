/**
 * Spell knowledge that is nobody's wire state: the word a cast sends, and
 * what a spell's ability rows say it can cure — the realm's own marks, read
 * for the settings screen's cure gates.
 *
 * The vocabulary is `abilities.ts`'s, and the rules are from the shipped
 * realm's own cure spells (read 2026-09-01, `resources/world/paradigm.jsonl.gz`):
 *
 * - `cure poison` (19) and `antidote` (31) both carry `CurePoison` (20), and
 *   both also carry `DispellMagic` (73) valued `Poison` (19) — either mark is
 *   the realm saying *cures poison*.
 * - `cure blindness` (87) carries exactly one row: `DispellMagic` (73) valued
 *   `BlindUser` (107).
 * - `cure disease` (150, 223) carries **no disease marker at all** — only
 *   `RemovesSpell` (122) rows naming individual afflictions (`plague`,
 *   `leprosy`, `rotting flesh`), and nothing in the data marks an affliction
 *   as a disease. So there is no sound positive rule, and none is invented: a
 *   spell that "removes ≥ N damage spells" also matches `smite` (which
 *   removes `greater smite` as a combat interlock). The only sound claim is
 *   the **negative** one — a book holding no `RemovesSpell` carrier at all
 *   cannot cure a disease — and that is the only claim `disease` makes.
 *
 * Dependency-free like everything in `shared/`. `WorldSpell` is a *type*,
 * which is erased — see the module-cycle rule in `CLAUDE.md`: a type-only cycle
 * is harmless where a value cycle is not. `abilities.ts` is a value import and
 * safe for the other half of that rule: it imports nothing, so it cannot be
 * the far side of a cycle.
 */

import { HAZARD_ABILITY } from './abilities';
import { commandOf } from './commands';
import type { WorldSpell } from './world';

/**
 * One spell as a cast resolver needs it — `KnownSpell` (the `sp`/`pow`
 * listing) and the realm table's rows both satisfy it structurally, so this
 * module imports neither as a value.
 */
export interface CastableSpell {
  name: string;
  short: string | null;
  /**
   * What one cast costs, where the source states it.
   *
   * Optional because the two sources state it in different columns and only
   * one of them is here: `KnownSpell.cost` is the `sp`/`pow` listing's own
   * figure — **this character's** cost, which is the authoritative one — while
   * the realm table calls it `mana` and is read off `ResolvedSpell.realm`. Null
   * is a row that has one and did not say (a spell learned from the level-up
   * line has only a name); absent is a source with no such column.
   */
  cost?: number | null;
}

/**
 * A configured spell name resolved to the spell itself.
 *
 * **Everything is an entity.** A caster used to be handed three separate
 * projections of one row — an abbreviation, an id, a duration — each through
 * its own callback, so a module that needed a fourth fact about the spell it
 * was about to cast had to be given a fourth lambda, and nothing could ask a
 * question the wiring had not anticipated. What crosses now is the realm's row
 * whole; a caller takes the field it wants off it. `AutoCombat` wants the word,
 * `Blessings` wants the word and the id, and anything that has to know what a
 * cast will cost wants `mana` — which nothing could have asked for before.
 *
 * Both halves are optional and mean different things. `known` is **this
 * character's** listing (`sp` / `pow`) and is the authority on what can be cast
 * at all; `realm` is the shipped table and knows what the listing never states
 * — the level, the mana, what casting it does. A spell in neither is a name
 * this client cannot improve on, and is sent as typed.
 */
export interface ResolvedSpell {
  /** What the options file said, trimmed. */
  configured: string;
  /** The one word a cast sends. See `castWord`. */
  word: string;
  /** The `sp`/`pow` listing's own entry, where this character knows it. */
  known: CastableSpell | null;
  /** The realm table's row, where the realm names it. */
  realm: WorldSpell | null;
}

/**
 * What one cast of this spell costs, or null when nothing has said.
 *
 * The character's own listing first and the realm table second — the same
 * order `castWord` asks them in, and for the same reason: the listing is the
 * wire's own word on *this* character, where the table is what the shipped
 * data says about everybody's. A spell neither source states a cost for is
 * genuinely unpriced, and the caller must not read that as free **or** as
 * unaffordable.
 */
export function spellCost(spell: ResolvedSpell): number | null {
  return spell.known?.cost ?? spell.realm?.mana ?? null;
}

/**
 * The spell a configured name means, with everything either source knows.
 *
 * The listing is asked first for the same reason `castWord` asks it first: it
 * is the wire's own word on *this character's* spells, where the realm table is
 * what the shipped data says about every character's.
 */
export function resolveSpell(
  configured: string,
  spellbook: ReadonlyArray<CastableSpell> | null | undefined,
  realmSpell: (name: string) => WorldSpell | null = () => null
): ResolvedSpell {
  const wanted = configured.trim();
  const needle = wanted.toLowerCase();
  const known =
    (spellbook ?? []).find(
      (spell) => spell.name.toLowerCase() === needle || spell.short?.toLowerCase() === needle
    ) ?? null;
  const realm = wanted.length === 0 ? null : realmSpell(wanted);
  return {
    configured: wanted,
    word: castWord(wanted, spellbook, (name) => realmSpell(name)?.short ?? null),
    known,
    realm
  };
}

/**
 * The word a cast actually sends: the realm's short name.
 *
 * The `Cast` command reads **one word** as the spell, and that word is the
 * listing's `Short` column, not a prefix of the name — measured live
 * (2026-09-01, orohost): `c pressure points Vaelor` answers `You do not know
 * how to cast pressure.` with `pres  pressure points` sitting right there in
 * the `powers` listing. So a configured spell is written as its readable
 * whole name and resolved to the short word at the moment of casting.
 *
 * The listing is authoritative — it is the wire's own word on this character's
 * spells — and the realm table answers when the listing has not arrived or
 * names no abbreviation. A name neither can shorten is sent as typed: on a
 * derivative realm with no data and no listing yet, refusing to cast would
 * stand down every heal for want of a lookup, and the server's own refusal is
 * the honest failure.
 */
export function castWord(
  configured: string,
  spellbook: ReadonlyArray<CastableSpell> | null | undefined,
  realmShort: (name: string) => string | null = () => null
): string {
  const wanted = configured.trim();
  if (wanted.length === 0) return wanted;
  const needle = wanted.toLowerCase();
  for (const spell of spellbook ?? []) {
    if (spell.name.toLowerCase() === needle || spell.short?.toLowerCase() === needle) {
      if (spell.short !== null && spell.short.length > 0) return spell.short;
      // Known to the listing but unabbreviated there — let the realm data try.
      break;
    }
  }
  return realmShort(wanted) ?? wanted;
}

/**
 * A command read as a cast: the spell's word and whatever follows it, or null.
 *
 * Two spellings reach the wire. `c <short> [target]` is the `Cast` command,
 * and the short name typed bare is the other — what this client sends
 * (`castWord`), because a mystic's `swan` has no `c` form, and what the
 * server reads as a cast either way: healbot's `rsto stat` was answered `You
 * may not cast that spell on a user!` (2026-09-22). A bare word is a cast only
 * when it is no command of the table's and `isSpellWord` owns it — the
 * character's listing, the realm's shorts — so `look` is never read as one.
 */
export function castOf(
  command: string,
  isSpellWord: (word: string) => boolean
): { word: string; argument: string } | null {
  const words = command.trim().split(/\s+/);
  const first = words[0] ?? '';
  if (first.length === 0) return null;
  const named = commandOf(first);
  if (named === 'Cast') {
    const word = words[1];
    return word === undefined ? null : { word, argument: words.slice(2).join(' ') };
  }
  if (named !== null || !isSpellWord(first)) return null;
  return { word: first, argument: words.slice(1).join(' ') };
}

/** Whether a word is the short name of a spell in this book, case-insensitively. */
export function isShortIn(
  word: string,
  spellbook: ReadonlyArray<CastableSpell> | null | undefined
): boolean {
  const needle = word.trim().toLowerCase();
  return (
    needle.length > 0 && (spellbook ?? []).some((spell) => spell.short?.toLowerCase() === needle)
  );
}

/**
 * A command read as this character's cast (`castOf`): a bare word is a spell
 * when the listing, or the realm's table, has it as a short name — the realm
 * answering before the listing has been read.
 */
export function castIn(
  command: string,
  spellbook: ReadonlyArray<CastableSpell> | null | undefined,
  realmSpell: (name: string) => WorldSpell | null
): { word: string; argument: string } | null {
  return castOf(
    command,
    (word) =>
      isShortIn(word, spellbook) || realmSpell(word)?.short?.toLowerCase() === word.toLowerCase()
  );
}

/**
 * Whether two spellings name one spell — a configured name against the word
 * a command sent, or the whole name a confirmation printed.
 *
 * The realm accepts `bles` wherever it accepts `bless` and a MegaMUD-trained
 * player configures the abbreviation, while the server prints the whole name,
 * so equality alone held a configured `bles` against a recorded `bless` for
 * ever. The realm's row decides where it names both, by **id**; where it does
 * not, every spelling the listing or the realm knows for either is compared.
 * One answer for every module that asks (2026-09-24): `Blessings`,
 * `AutoInvoke` and `AutoCombat` each had their own.
 */
export function sameSpell(
  a: string,
  b: string,
  spellbook: ReadonlyArray<CastableSpell> | null | undefined,
  realmSpell: (name: string) => WorldSpell | null
): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return true;
  const first = realmSpell(a)?.id;
  const second = realmSpell(b)?.id;
  if (first !== undefined && second !== undefined) return first === second;
  const spellings = (name: string): string[] => {
    const found = resolveSpell(name, spellbook, realmSpell);
    return [found.word, found.known?.name, found.known?.short, found.realm?.name]
      .filter((spelling): spelling is string => typeof spelling === 'string')
      .map((spelling) => spelling.trim().toLowerCase());
  };
  return spellings(a).includes(y) || spellings(b).includes(x);
}

/** `Abil-n` ids, as `abilities.ts` names them. */
const CURE_POISON = 20;
const DISPELL_MAGIC = 73;
const POISON = 19;
const BLIND_USER = 107;
const REMOVES_SPELL = 122;
const HEALS = 18;
/** `Freedom`: ends whatever holds the character in place (`HoldPerson`). */
const FREEDOM = 81;

export type AbilityPairs = ReadonlyArray<readonly [number, number]>;

/**
 * Whether a book of known spells can answer each cure the client automates.
 *
 * `poison` and `blindness` are positive claims from unambiguous marks;
 * `disease` is the negative gate described above — true means *might*, false
 * means *certainly not*. The caller passes one ability list per known spell,
 * with `undefined` standing for a spell the realm does not name (a derivative
 * realm, a spell learned from the level-up line): an unnameable spell keeps
 * every gate open, because "the realm cannot say" must never disable a cure.
 */
export interface CureGates {
  poison: boolean;
  blindness: boolean;
  disease: boolean;
  /** A positive claim, like poison's: the realm's own `Freedom` mark (81). */
  freedom: boolean;
}

/**
 * What a single spell *serves*, for offering items that could be used on it
 * (todo 19).
 *
 * `cureGates` above answers a different question — *can this book cure X at
 * all* — and deliberately opens every gate for a spell the realm cannot name,
 * because a cure must never be disabled by ignorance. This is the offering
 * side, where the opposite is right: a list of items to choose from must hold
 * only items the realm **says** serve the condition, so an unnameable spell
 * serves nothing rather than everything.
 *
 * `diseased` is the honest weak one. There is no *cure disease* mark; the
 * realm states `RemovesSpell`, a generic dispel, so a row carrying it *might*
 * end a disease. Offered, and it is why the list for disease is long.
 *
 * `held` is the realm's own `Freedom` mark (81) — the `freedom` spell and the
 * items that cast it — which is MegaMUD's Freedom slot, cast when the
 * character cannot move.
 */
export function spellServes(abilities: AbilityPairs | undefined): {
  hp: boolean;
  poisoned: boolean;
  blind: boolean;
  diseased: boolean;
  held: boolean;
} {
  const serves = { hp: false, poisoned: false, blind: false, diseased: false, held: false };
  if (abilities === undefined) return serves;
  for (const [id, value] of abilities) {
    if (id === HEALS) serves.hp = true;
    if (id === CURE_POISON) serves.poisoned = true;
    if (id === DISPELL_MAGIC && value === POISON) serves.poisoned = true;
    if (id === DISPELL_MAGIC && value === BLIND_USER) serves.blind = true;
    if (id === REMOVES_SPELL) serves.diseased = true;
    if (id === FREEDOM) serves.held = true;
  }
  return serves;
}

export function cureGates(spells: ReadonlyArray<AbilityPairs | undefined>): CureGates {
  let poison = false;
  let blindness = false;
  let disease = false;
  let freedom = false;
  for (const abilities of spells) {
    if (abilities === undefined) {
      return { poison: true, blindness: true, disease: true, freedom: true };
    }
    for (const [id, value] of abilities) {
      if (id === CURE_POISON) poison = true;
      if (id === DISPELL_MAGIC && value === POISON) poison = true;
      if (id === DISPELL_MAGIC && value === BLIND_USER) blindness = true;
      if (id === REMOVES_SPELL) disease = true;
      if (id === FREEDOM) freedom = true;
    }
  }
  return { poison, blindness, disease, freedom };
}

/**
 * Whether this spell stops the character moving while it lasts.
 *
 * **The server's own test, not a reading of the spell's name.**
 * `ActionFigure.CheckForHoldPerson` asks `GetAbility(HoldPerson)` and nothing
 * else; a move is refused by `Exits.Move` (`inActionFigure.CheckForHoldPerson()`
 * on a `Normal` or `ActionExit` move) before anybody is moved anywhere. So the
 * ability row *is* the definition, and the 60 spells on the shipped realm that
 * carry it are the whole list — `knockdown`, `entangle`, `thick webbing`,
 * `freeze`, `hold person`, `paralyze`, `chain`, `gust of wind`, `roar` and the
 * rest, which no naming rule would have gathered and no memory of MajorMUD
 * would have got right.
 *
 * The ability id is `HAZARD_ABILITY.holdPerson` rather than a second literal
 * here: `menace.ts` already prices a round of it, and a number that decides
 * two things in two spellings is the pair this codebase keeps together
 * everywhere else.
 *
 * `undefined` abilities is a realm that does not say — a derivative realm, a
 * pre-v14 conversion — and answers false, which never holds a walk. The
 * refusal on the wire is what catches those: see `CharacterTracker`'s
 * `spell-onset` case.
 */
export function holdsMovement(spell: Pick<WorldSpell, 'abilities'> | null | undefined): boolean {
  return (spell?.abilities ?? []).some(([id]) => id === HAZARD_ABILITY.holdPerson);
}

/**
 * Whether a spell confuses — `ActionFigure.CheckConfusion` tests one
 * ability, `Confusion` (71), on every effect up, and a hit throws the
 * command away. `holdsMovement`'s shape, for the same reason: the sentences
 * are message data, the ability is the realm's own word (todo 05).
 */
export function confuses(spell: Pick<WorldSpell, 'abilities'> | null | undefined): boolean {
  return (spell?.abilities ?? []).some(([id]) => id === HAZARD_ABILITY.confusion);
}

/**
 * Who a spell may be cast on, from `Spells.Targets`.
 *
 * The realm records this in a column the database documents nowhere, so the
 * reading is derived from the shipped data itself rather than from another
 * client's source — and it is stated here, once, so a correction reaches every
 * realm without reconverting one.
 *
 * Read 2026-09-02 over the **learnable** rows of both engines, which is the
 * population a picker actually offers (289 spells on `gmud20230902.mdb`, 238 on
 * the stock `data-v1.11p.mdb`). The two agree on every value:
 *
 * | Targets | What is in it | Read as |
 * |---|---|---|
 * | absent/0 | the realm's own zero, a pre-v17 conversion, or a spell it cannot name | `unknown` |
 * | 1 | `magic armour`, `barkskin`, `shadowform`, `way of the swan` | `self` |
 * | 2 | `minor healing`, `bless`, `cure poison`, `mend`, `resist fire` | `friendly` — self or another |
 * | 4 | `turn undead`, `enslave`, `charm animal`, `exorcism` | `creature` |
 * | 7 | `detect magic`, `song of lore` | `other` |
 * | 8 | `magic missile`, `lightning bolt`, `harm`, `curse` | `enemy` |
 * | 11 | `wizard knock` | `other` |
 * | 12 | `fireball`, `swarm`, `stinking cloud`, `paralyze` | `enemies` |
 * | 13 | `healing rain`, `holy aura`, `chant`, `mass frenzy` | `party` — everyone friendly at once |
 *
 * The two that decide anything here are **1 and 2**, and they are the reason
 * this exists: `way of the swan` is a self heal and `minor healing` is not, and
 * with the column unread a party-heal field would offer both — which sends
 * `c swan <name>` once a round for a refusal the server prints in the room.
 *
 * `unknown` is a value this table has never seen, and it is deliberately not a
 * refusal: a derivative realm may number its own column differently, and a
 * picker that emptied itself on an unrecognised number would be unusable there.
 */
export type SpellTargeting =
  'self' | 'friendly' | 'party' | 'creature' | 'enemy' | 'enemies' | 'other' | 'unknown';

export function spellTargeting(targets: number | undefined | null): SpellTargeting {
  /*
   * Absent is `unknown`, deliberately, and never `self`.
   *
   * Three different things arrive as absent and the client cannot tell them
   * apart: the realm's own zero (left out at build time like every zero here),
   * a realm converted before v17, and a spell the realm has never heard of.
   * Reading that as `self` looks harmless and is not — it makes `castsBare`
   * true, so a *party* heal configured with a spell the realm cannot name
   * would be cast with the member's name dropped, healing the caster instead
   * of the person who is dying. `unknown` keeps every picker open and sends
   * the name, which is what the configuration asked for.
   *
   * Nothing is lost on the realm's own zeroes: all 72 are monster breaths,
   * traps and caster-only effects, none is learnable, and a self cast is bare
   * anyway because it has no target to name.
   */
  if (targets === undefined || targets === null || targets === 0) return 'unknown';
  switch (targets) {
    case 1:
      return 'self';
    case 2:
      return 'friendly';
    case 13:
      return 'party';
    case 4:
      return 'creature';
    case 8:
      return 'enemy';
    case 12:
      return 'enemies';
    case 6:
    case 7:
    case 11:
      return 'other';
    default:
      return 'unknown';
  }
}

/**
 * Whether the caster is a target this spell accepts.
 *
 * `unknown` says yes, for the reason above: an unrecognised number is the
 * client's ignorance and must not take a field away from somebody on a realm
 * this build has never seen.
 */
export function castsOnSelf(targeting: SpellTargeting): boolean {
  return (
    targeting === 'self' ||
    targeting === 'friendly' ||
    targeting === 'party' ||
    targeting === 'unknown'
  );
}

/**
 * Whether somebody *else* is a target this spell accepts.
 *
 * `self` is the one answer that is a no, and it is the whole point of the
 * column: a self-only spell in the party-heal field is a command sent once a
 * round to be refused out loud in the room.
 */
export function castsOnOthers(targeting: SpellTargeting): boolean {
  return targeting === 'friendly' || targeting === 'party' || targeting === 'unknown';
}

/**
 * Whether a cast at a named target should send the name at all.
 *
 * A `party` spell (`healing rain`) is cast bare and reaches everyone friendly
 * in the room; naming somebody on one is a word the `Cast` command does not
 * want. Everything else that can reach another person takes the name.
 */
export function castsBare(targeting: SpellTargeting): boolean {
  return targeting === 'self' || targeting === 'party';
}
