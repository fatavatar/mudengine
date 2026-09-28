/**
 * MegaMUD's per-realm tables, as this client's own mechanisms (2026-09-28).
 *
 * A realm's *Messages* table was imported, on this fork, into a
 * `messages.yaml` its own engine ran; its *Monsters* table into a
 * `monsters.yaml` of monster rows. Neither engine survives the merge with
 * upstream, because both questions already have homes there:
 *
 * - **A sentence that asks for an answer** is a rule with a `line` trigger
 *   (`rules.ts`): the response is `then`, a bare `^M` an Enter.
 * - **A sentence that starts something lasting** is an effect the realm
 *   states (`StatedEffect`): the start, the end and what it means, read by
 *   the effect tracker beside the realm's own ability rows.
 * - **A monster row** is a `MobRule`: a stance, or a priority band with the
 *   spell it is fought with.
 *
 * What none of them can carry is returned as `dropped`, with the reason, so
 * the migration that runs this can say so rather than guess.
 */
import type { EffectMeaning, StatedEffect } from './spell-messages';
import type { MobPriorityBand, MobRule } from './mobRules';
import { MOB_PRIORITIES } from './mobRules';

/** Why a row could not be carried: the migration's note says each in words. */
export type DroppedWhy = 'names-somebody' | 'pause-or-random' | 'run' | 'pre-attack';

/** What a converter could not carry, and why, for the note that reports it. */
export interface Dropped {
  name: string;
  why: DroppedWhy;
}

/** A rule as the options file states it, ready to write into `server.yaml`. */
export interface RuleRow {
  name: string;
  enabled?: false;
  when: { line: string; speech?: true };
  then: string | string[];
}

const MEANINGS: readonly EffectMeaning[] = ['blind', 'poisoned', 'diseased', 'held', 'confused'];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * A response in MegaMUD's syntax as commands: `^M` ends one, a trailing one
 * adds nothing, and a response that is `^M` alone is one bare Enter (`''`).
 * Null for `~` (a pause) or `a||b` (a random pick), which a rule cannot say.
 */
export function commandsOf(response: string): string[] | null {
  if (response.includes('~') || response.includes('||')) return null;
  const parts = response.split(/\^M/i).map((part) => part.trim());
  if (parts.at(-1) === '' && parts.length > 1) parts.pop();
  return parts;
}

/**
 * A `messages.yaml` table as rules and stated effects. Names are made unique,
 * because a rule list keeps the first of two rules with one name and MegaMUD's
 * table repeats them (`acid hits` twice).
 */
export function fromMessages(rows: unknown): {
  rules: RuleRow[];
  effects: StatedEffect[];
  dropped: Dropped[];
} {
  const rules: RuleRow[] = [];
  const effects: StatedEffect[] = [];
  const dropped: Dropped[] = [];
  const used = new Map<string, number>();
  const unique = (name: string): string => {
    const seen = (used.get(name.toLowerCase()) ?? 0) + 1;
    used.set(name.toLowerCase(), seen);
    return seen === 1 ? name : `${name} ${seen}`;
  };

  for (const raw of Array.isArray(rows) ? rows : []) {
    if (raw === null || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const name = text(row['name']) || text(row['match']);
    const match = text(row['match']);
    if (name.length === 0 || match.length === 0) continue;
    const ends = text(row['endsWith']);
    const response = text(row['response']);
    const action = text(row['action']);
    const marks = Array.isArray(row['effects']) ? row['effects'].map(text) : [];
    const enabled = row['enabled'] !== false;

    const means = new Set<EffectMeaning>(MEANINGS.filter((meaning) => marks.includes(meaning)));
    // Standing still until it ends is what `wait` and "cannot attack" ask for.
    if (action === 'wait' || marks.includes('no-attack')) means.add('held');
    const lasts = ends.length > 0 && (marks.length > 0 || action === 'wait');
    if (lasts && enabled) {
      if (match.includes('{') || ends.includes('{')) {
        dropped.push({ name, why: 'names-somebody' });
      } else {
        effects.push({ name, starts: match, ends, means: [...means] });
      }
    }

    const answer = action === 'look' ? [''] : response.length > 0 ? commandsOf(response) : [];
    if (answer === null) {
      dropped.push({ name, why: 'pause-or-random' });
      continue;
    }
    if (action === 'run') dropped.push({ name, why: 'run' });
    if (answer.length === 0) continue;
    const chase = row['chase'] === true;
    rules.push({
      name: unique(name),
      // A chase row was never matched (the client cannot yet follow through a
      // special exit), and a disabled one was switched off by the player.
      ...(enabled && !chase ? {} : { enabled: false as const }),
      when: { line: match, ...(row['conversations'] === true ? { speech: true as const } : {}) },
      then: answer.length === 1 ? answer[0]! : answer
    });
  }
  return { rules, effects, dropped };
}

const STANCES: Readonly<Record<string, 'friend' | 'never' | 'escape' | 'hangup'>> = {
  friend: 'friend',
  avoid: 'never',
  escape: 'escape',
  hangup: 'hangup'
};

/** One `monsters` row as a `MobRule`; null for a row that says nothing a rule can. */
export function mobRuleOf(raw: unknown): MobRule | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const mob = text(row['mob']);
  if (mob.length === 0) return null;
  const stance = STANCES[text(row['relationship'])];
  if (stance !== undefined) return { mob, treat: stance };
  const priority = text(row['priority']);
  const treat: MobPriorityBand = (MOB_PRIORITIES as readonly string[]).includes(priority)
    ? (priority as MobPriorityBand)
    : 'default';
  const attack = row['attack'];
  const spell =
    attack !== null && typeof attack === 'object'
      ? text((attack as Record<string, unknown>)['spell'])
      : '';
  const times =
    attack !== null && typeof attack === 'object'
      ? Number((attack as Record<string, unknown>)['max']) || 0
      : 0;
  const noBackstab = row['noBackstab'] === true;
  const notHostile = row['notHostile'] === true;
  // The default band and nothing else is no rule at all.
  if (treat === 'default' && spell.length === 0 && !noBackstab && !notHostile) return null;
  return {
    mob,
    treat,
    ...(spell.length > 0 ? { cast: { spell, times } } : {}),
    ...(noBackstab ? { noBackstab } : {}),
    ...(notHostile ? { notHostile } : {})
  };
}

/** A `monsters` list as `MobRule`s, and what could not be carried. */
export function fromMonsters(rows: unknown): { rules: MobRule[]; dropped: Dropped[] } {
  const rules: MobRule[] = [];
  const dropped: Dropped[] = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const rule = mobRuleOf(raw);
    if (rule !== null) rules.push(rule);
    const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (row['preAttack'] !== undefined) {
      dropped.push({ name: text(row['mob']), why: 'pre-attack' });
    }
  }
  return { rules, dropped };
}
