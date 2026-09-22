/**
 * A realm's message triggers: *when the realm says this, it means that*.
 *
 * MegaMUD kept a table of the game's sentences that matter — `You are
 * confused`, `A skeleton arises from its place of rest`, `You suffer in the
 * desert heat...` — and against each one what it means (a condition that
 * starts, and the sentence that ends it), what to do about it, and what to
 * send back. Its `Messages.md` is that table, and a player who has played with
 * MegaMUD for years has one tuned to their realm. This is the same table,
 * read from that file and kept per realm.
 *
 * **On the realm, because a sentence is.** Every character on one realm hears
 * the same sentences, and a table stated per character would be the same
 * table written out once each. See `Server.mobPriority` for the same argument.
 *
 * **Imported, not shipped.** The table is the player's own — MegaMUD merges
 * four layers of it (installed defaults, all characters, per BBS, per
 * character) and the one somebody relies on may be any of them — so the
 * client reads the file they point it at rather than guessing which.
 *
 * Pure: no `fs`, no timers. The file format and the matching live here so the
 * importer, the store, the runtime and the settings screen read one statement
 * of each.
 */
import type { UiLookup } from './i18n';
import { isRecord } from './values';

/**
 * What a sentence says has started, and holds until its `endsWith` arrives.
 *
 * MegaMUD's eleven effect boxes, bit for bit — the layout is its own, read out
 * of the save routine in `megamud.exe` (`0x468f29`) rather than guessed from
 * the dialog, because the dialog lists them in a different order from the
 * bits. `0x0100` is unused; the three option bits are separate fields below.
 */
export const MESSAGE_EFFECTS = [
  'blind',
  'confused',
  'poisoned',
  'losing-hp',
  'held',
  'no-attack',
  'diseased',
  'hp-regen',
  'mana-regen',
  'ends-combat',
  'action-failed'
] as const;
export type MessageEffect = (typeof MESSAGE_EFFECTS)[number];

/** Each effect's bit in a MegaMUD flag word. */
export const MEGAMUD_EFFECT_BITS: Readonly<Record<MessageEffect, number>> = {
  blind: 0x0001,
  confused: 0x0002,
  poisoned: 0x0004,
  'losing-hp': 0x0008,
  held: 0x0010,
  'no-attack': 0x0020,
  diseased: 0x0040,
  'hp-regen': 0x0080,
  'mana-regen': 0x0200,
  'ends-combat': 0x1000,
  'action-failed': 0x2000
};

/** The option bits, which are about matching rather than meaning. */
export const MEGAMUD_ANYWHERE = 0x0400;
export const MEGAMUD_CONVERSATIONS = 0x0800;
export const MEGAMUD_CHASE = 0x4000;
export const MEGAMUD_DISABLED = 0x8000;

/**
 * What to do about a sentence, in MegaMUD's radio order — the file stores the
 * index, so the order is the format.
 */
export const MESSAGE_ACTIONS = [
  'none',
  'look',
  'wait',
  'rest-hp',
  'rest-mana',
  'run',
  'hang-up'
] as const;
export type MessageAction = (typeof MESSAGE_ACTIONS)[number];

export interface MessageTrigger {
  /** What the player calls it: the spell's name, `monster entry`, `desert damage`. */
  name: string;
  /**
   * The sentence, or part of one — matched anywhere in a line, with
   * `{target}`, `{source}`, `{dmg}` and `{1}`…`{5}` standing for whatever the
   * realm put there.
   */
  match: string;
  /** The sentence that ends what `match` started. Empty: nothing lasts. */
  endsWith: string;
  /**
   * What to send, in MegaMUD's own syntax: `^M` separates commands, `~` waits
   * half a second, `a||b` picks one at random, and the tokens `match` captured
   * are substituted. Empty: nothing is sent.
   */
  response: string;
  effects: MessageEffect[];
  action: MessageAction;
  /**
   * MegaMUD's *find anywhere in text*: the sentence may start mid-line, after
   * whatever the realm printed before it on the same line. Every match here is
   * already a substring match, so this is kept for the round trip and for the
   * settings screen, and changes nothing about matching.
   */
  anywhere: boolean;
  /**
   * Also matched inside something somebody *said*. Off by default, and off
   * for a reason: without it anybody could gossip a sentence and steer every
   * client listening.
   */
  conversations: boolean;
  /**
   * Only meant while following a player through a special exit. Kept so a
   * table survives the round trip whole; never matched until the client can
   * chase, which it cannot yet.
   */
  chase: boolean;
  enabled: boolean;
}

/** Where a realm's table came from, for the settings screen to say. */
export interface MessageTableSource {
  file: string;
  importedAt: string;
}

export interface MessageTable {
  source: MessageTableSource | null;
  triggers: MessageTrigger[];
}

export const EMPTY_MESSAGE_TABLE: MessageTable = { source: null, triggers: [] };

/** A blank trigger, for the settings screen's *Add*. */
export function blankTrigger(): MessageTrigger {
  return {
    name: '',
    match: '',
    endsWith: '',
    response: '',
    effects: [],
    action: 'none',
    anywhere: false,
    conversations: false,
    chase: false,
    enabled: true
  };
}

/* ---------------------------------------------------------- MegaMUD's file */

/** A line of the file that did not become a trigger, and why. */
export interface ImportSkip {
  /** One-based, as an editor shows it. */
  line: number;
  why: 'not-a-header' | 'no-message';
}

export interface MegaMudImport {
  triggers: MessageTrigger[];
  skipped: ImportSkip[];
}

/**
 * `name:FLAGS:ACTION:response` — flags four hex digits, the action an index.
 *
 * The name is lazy and the response takes the rest, because a response may
 * hold a colon (`say hi: back soon`) and a name, in the whole of the shipped
 * table, never holds one followed by four hex digits and a number.
 */
const HEADER = /^(.*?):([0-9A-Fa-f]{4}):(\d+):(.*)$/;

/**
 * Reads MegaMUD's `Messages.md`.
 *
 * Three lines a record, always: the header, the sentence, and the sentence
 * that ends it — the third present but empty when nothing ends. No separator
 * between records. Line endings are CRLF on disk and are not relied on.
 *
 * A line where a header should be is skipped and reported rather than
 * resynchronised around silently: a file somebody hand-edited into a
 * different shape is something they should hear about, and one bad line
 * costs one record, not the rest of the file.
 */
export function parseMegaMudMessages(text: string): MegaMudImport {
  const lines = text.split(/\r\n|\r|\n/);
  const triggers: MessageTrigger[] = [];
  const skipped: ImportSkip[] = [];

  let at = 0;
  while (at < lines.length) {
    const header = lines[at]!;
    if (header.trim().length === 0) {
      at += 1;
      continue;
    }
    const parts = HEADER.exec(header);
    if (!parts) {
      skipped.push({ line: at + 1, why: 'not-a-header' });
      at += 1;
      continue;
    }
    const match = (lines[at + 1] ?? '').trim();
    const endsWith = (lines[at + 2] ?? '').trim();
    const headerLine = at + 1;
    at += 3;
    if (match.length === 0) {
      skipped.push({ line: headerLine, why: 'no-message' });
      continue;
    }

    const flags = Number.parseInt(parts[2]!, 16);
    const actionIndex = Number(parts[3]);
    triggers.push({
      name: parts[1]!.trim(),
      match,
      endsWith,
      response: parts[4]!,
      effects: MESSAGE_EFFECTS.filter((effect) => (flags & MEGAMUD_EFFECT_BITS[effect]) !== 0),
      action: MESSAGE_ACTIONS[actionIndex] ?? 'none',
      anywhere: (flags & MEGAMUD_ANYWHERE) !== 0,
      conversations: (flags & MEGAMUD_CONVERSATIONS) !== 0,
      chase: (flags & MEGAMUD_CHASE) !== 0,
      enabled: (flags & MEGAMUD_DISABLED) === 0
    });
  }

  return { triggers, skipped };
}

/* --------------------------------------------------- the file on the realm */

/**
 * A realm's table as it is kept on disk, from whatever the file held.
 *
 * Forgiving per row and strict per field, like every normalizer here: a row
 * with no sentence is dropped, an unknown effect is dropped from its row, and
 * an unknown action reads as `none`.
 */
export function asMessageTable(value: unknown): MessageTable {
  if (!isRecord(value)) return EMPTY_MESSAGE_TABLE;
  const rawSource = value['source'];
  const source =
    isRecord(rawSource) &&
    typeof rawSource['file'] === 'string' &&
    typeof rawSource['importedAt'] === 'string'
      ? { file: rawSource['file'], importedAt: rawSource['importedAt'] }
      : null;
  return { source, triggers: asMessageTriggers(value['messages']) };
}

export function asMessageTriggers(value: unknown): MessageTrigger[] {
  if (!Array.isArray(value)) return [];
  const out: MessageTrigger[] = [];
  for (const entry of value) {
    const trigger = asMessageTrigger(entry);
    if (trigger) out.push(trigger);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function asMessageTrigger(value: unknown): MessageTrigger | null {
  if (!isRecord(value)) return null;
  const match = text(value['match']).trim();
  if (match.length === 0) return null;
  const effects = Array.isArray(value['effects'])
    ? MESSAGE_EFFECTS.filter((effect) => (value['effects'] as unknown[]).includes(effect))
    : [];
  const action = MESSAGE_ACTIONS.find((known) => known === value['action']) ?? 'none';
  return {
    name: text(value['name']).trim(),
    match,
    endsWith: text(value['endsWith']).trim(),
    response: text(value['response']),
    effects,
    action,
    anywhere: value['anywhere'] === true,
    conversations: value['conversations'] === true,
    chase: value['chase'] === true,
    enabled: value['enabled'] !== false
  };
}

/**
 * A trigger as the file writes it: only what differs from a blank one, so
 * six hundred rows read as six hundred sentences rather than six thousand
 * `false`s.
 */
export function triggerForFile(trigger: MessageTrigger): Record<string, unknown> {
  const out: Record<string, unknown> = { name: trigger.name, match: trigger.match };
  if (trigger.endsWith.length > 0) out['endsWith'] = trigger.endsWith;
  if (trigger.response.length > 0) out['response'] = trigger.response;
  if (trigger.effects.length > 0) out['effects'] = [...trigger.effects];
  if (trigger.action !== 'none') out['action'] = trigger.action;
  if (trigger.anywhere) out['anywhere'] = true;
  if (trigger.conversations) out['conversations'] = true;
  if (trigger.chase) out['chase'] = true;
  if (!trigger.enabled) out['enabled'] = false;
  return out;
}

/* ------------------------------------------------------------- matching */

/** The tokens a sentence may hold, and what each stands for. */
const TOKEN = /\{(target|source|dmg|[1-5])\}/g;

/** What a matched sentence captured, by token name. */
export type Captures = Readonly<Record<string, string>>;

export interface CompiledSentence {
  /** The longest literal stretch, tested with `includes` before the regex runs. */
  literal: string;
  pattern: RegExp;
  tokens: string[];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A sentence as something a line can be tested against.
 *
 * Case-sensitive, like MegaMUD's own match, and unanchored: the sentence may
 * sit anywhere in the line. A name token is lazy, so a leading `{target}`
 * takes the line from its start — the leftmost match wins — and a trailing
 * one, which a lazy token would leave one character long, is greedy. `{dmg}`
 * is digits and nothing else.
 */
export function compileSentence(sentence: string): CompiledSentence {
  const tokens: string[] = [];
  let source = '';
  let longest = '';
  let last = 0;
  const matches = [...sentence.matchAll(TOKEN)];
  matches.forEach((token, index) => {
    const literal = sentence.slice(last, token.index);
    if (literal.length > longest.length) longest = literal;
    source += escapeRegex(literal);
    tokens.push(token[1]!);
    const trailing =
      index === matches.length - 1 && token.index + token[0].length === sentence.length;
    source += token[1] === 'dmg' ? '(\\d+)' : trailing ? '(.+)' : '(.+?)';
    last = token.index + token[0].length;
  });
  const tail = sentence.slice(last);
  if (tail.length > longest.length) longest = tail;
  source += escapeRegex(tail);
  return { literal: longest, pattern: new RegExp(source), tokens };
}

/** What a line captured against a sentence, or null when it does not hold it. */
export function matchSentence(compiled: CompiledSentence, line: string): Captures | null {
  if (compiled.literal.length > 0 && !line.includes(compiled.literal)) return null;
  const found = compiled.pattern.exec(line);
  if (!found) return null;
  const captures: Record<string, string> = {};
  compiled.tokens.forEach((token, index) => {
    captures[token] = (found[index + 1] ?? '').trim();
  });
  return captures;
}

/* ------------------------------------------------------------- responses */

/** One command a response sends, and how long after the response began. */
export interface ResponseStep {
  command: string;
  delayMs: number;
}

/** MegaMUD's `~`: a half-second pause. */
export const RESPONSE_PAUSE_MS = 500;

/**
 * A response as the commands it sends.
 *
 * MegaMUD's syntax, from its help's *Control Character Sequences*:
 *
 * - `a||b||c` picks one alternative at random, and an empty alternative is
 *   a legitimate *say nothing this time*. Picked first, so the separators
 *   below belong to the alternative chosen.
 * - `^M` is Enter: it ends a command. A trailing `^M` ends the last one
 *   rather than adding an empty one, and a response that is `^M` alone is one
 *   bare Enter — which MajorMUD answers by drawing the room again, and is
 *   what MegaMUD sends after an ambient sentence to see who arrived.
 * - A last command with no `^M` after it is sent all the same. MegaMUD's own
 *   table spells `stat` and `stat^M` interchangeably, and this client sends
 *   nothing that is not a whole line.
 * - `~` waits half a second before whatever follows, so `look^M~look^M`
 *   sends the second look half a second after the first.
 * - `^^`, `^~` and `^|` are a literal `^`, `~` and `|`; `^[` is Escape.
 * - `{target}` and the rest are what the sentence captured. `{userid}` and
 *   `{pswd}` are **not** substituted: a response is sent in the clear to
 *   whatever the realm is showing, and an account's password is never one.
 *
 * `random` is injected so the choice can be tested.
 */
export function expandResponse(
  response: string,
  captures: Captures,
  random: () => number = Math.random
): ResponseStep[] {
  const alternatives = splitAlternatives(response);
  const chosen =
    alternatives[Math.min(alternatives.length - 1, Math.floor(random() * alternatives.length))] ??
    '';
  if (chosen.length === 0) return [];

  const substituted = chosen.replace(TOKEN, (_whole, name: string) => captures[name] ?? '');

  const steps: ResponseStep[] = [];
  let current = '';
  let delay = 0;
  let open = false;
  for (let i = 0; i < substituted.length; i += 1) {
    const ch = substituted[i]!;
    if (ch === '^' && i + 1 < substituted.length) {
      const next = substituted[i + 1]!;
      i += 1;
      if (next === 'M' || next === 'm') {
        steps.push({ command: current, delayMs: delay });
        current = '';
        open = false;
      } else if (next === '[') {
        current += '\u001b';
        open = true;
      } else {
        current += next;
        open = true;
      }
      continue;
    }
    // A pause, not a separator: `a~b` is MegaMUD typing `a`, waiting, and
    // typing `b` on the same line, so the realm receives `ab` half a second
    // late. The command carries the delay in force when its Enter is pressed.
    if (ch === '~') {
      delay += RESPONSE_PAUSE_MS;
      continue;
    }
    current += ch;
    open = true;
  }
  if (open && current.length > 0) steps.push({ command: current, delayMs: delay });
  return steps;
}

/** `a||b` split on the separator MegaMUD reads, leaving an escaped `^|` alone. */
function splitAlternatives(response: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < response.length; i += 1) {
    const ch = response[i]!;
    if (ch === '^' && i + 1 < response.length) {
      current += ch + response[i + 1]!;
      i += 1;
      continue;
    }
    if (ch === '|' && response[i + 1] === '|') {
      out.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/* ------------------------------------------------------------- the words */

/** What an effect is called, where a player reads it. */
export function messageEffectLabel(effect: MessageEffect, t: UiLookup): string {
  switch (effect) {
    case 'blind':
      return t('messages.effects.blind');
    case 'confused':
      return t('messages.effects.confused');
    case 'poisoned':
      return t('messages.effects.poisoned');
    case 'losing-hp':
      return t('messages.effects.losingHp');
    case 'held':
      return t('messages.effects.held');
    case 'no-attack':
      return t('messages.effects.noAttack');
    case 'diseased':
      return t('messages.effects.diseased');
    case 'hp-regen':
      return t('messages.effects.hpRegen');
    case 'mana-regen':
      return t('messages.effects.manaRegen');
    case 'ends-combat':
      return t('messages.effects.endsCombat');
    case 'action-failed':
      return t('messages.effects.actionFailed');
  }
}

/** What an action is called, where a player reads it. */
export function messageActionLabel(action: MessageAction, t: UiLookup): string {
  switch (action) {
    case 'none':
      return t('messages.actions.none');
    case 'look':
      return t('messages.actions.look');
    case 'wait':
      return t('messages.actions.wait');
    case 'rest-hp':
      return t('messages.actions.restHp');
    case 'rest-mana':
      return t('messages.actions.restMana');
    case 'run':
      return t('messages.actions.run');
    case 'hang-up':
      return t('messages.actions.hangUp');
  }
}

/** What an import read, or why it wrote nothing. */
export type MessageImport =
  | {
      ok: true;
      /** Rows now in the realm's table. */
      count: number;
      /** Of those, the chase rows kept but not answered. */
      chase: number;
      skipped: ImportSkip[];
    }
  | { ok: false; error: string };
