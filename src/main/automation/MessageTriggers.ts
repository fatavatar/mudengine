/**
 * A realm's message triggers, running: a sentence arrives, and what the realm's
 * table says about it happens.
 *
 * Three things, and only three, in this first cut:
 *
 * - **Responses are sent.** `drink water` in the desert, a bare Enter after
 *   an ambient sentence so the room is drawn again, `.LOW ON LIVES!` — each
 *   through `CommandQueue`, like everything automated, at `combat` priority so
 *   an answer to the realm goes ahead of the next step of a walk.
 * - **Effects are held.** A sentence with an `endsWith` starts something that
 *   lasts until that sentence arrives; what is held is readable (`effects`)
 *   for whatever comes to act on it. Nothing here acts on an effect or an
 *   action yet — resting out a confusion, holding an attack — because each of
 *   those belongs to the module that already owns the decision, and wiring
 *   them is its own change.
 * - **Every firing is traced**, into the same list the Automation card shows
 *   for rules, so *why did it just send that* has an answer on screen.
 *
 * **First match wins.** MegaMUD's table holds the same sentence under two
 * names more than once (`You are stunned` is `stunned` and `song of
 * stunning`), and answering one line twice would send its response twice.
 * Endings are checked separately and all of them: a line can end one effect
 * and start another.
 *
 * **Not inside a conversation**, unless the row says so — see
 * `MessageTrigger.conversations`.
 *
 * **Not inside a listing.** The `st` sheet prints each effect's own onset
 * sentence at its foot, and a row that answers `You awaken from unnatural
 * slumber.` with `st` would otherwise answer its own answer, for ever.
 */
import type { CommandQueue } from './CommandQueue';
import { t } from '../app/i18n';
import type { RuleFiring } from '../../shared/rules';
import {
  compileSentence,
  expandResponse,
  matchSentence,
  messageEffectLabel,
  type CompiledSentence,
  type MessageAction,
  type MessageEffect,
  type MessageTrigger
} from '../../shared/messageTriggers';

/**
 * The least time between two responses from one row.
 *
 * MegaMUD has none. This exists for the row a player writes that the realm
 * answers with its own sentence: without it, `stat` in answer to a line the
 * sheet prints back is a command a second the realm is too busy to refuse.
 */
const RESPONSE_GAP_MS = 1_000;

/**
 * How long an effect is held with no ending heard.
 *
 * MegaMUD holds one until its ending arrives, which is for ever when the
 * ending never does — a wear-off missed while the character was elsewhere, a
 * row whose ending was typed wrong. Ten minutes is MegaMUD's own ceiling for a
 * blessing it has not seen again, and no condition in its shipped table lasts
 * that long.
 */
const EFFECT_CEILING_MS = 10 * 60_000;

/** How many firings the trace keeps. The card shows twelve. */
const TRACE_LIMIT = 50;

interface Compiled {
  trigger: MessageTrigger;
  onset: CompiledSentence;
  end: CompiledSentence | null;
  /** Whether a match starts something worth holding until `end`. */
  lasts: boolean;
}

/** An effect a sentence started and nothing has ended yet. */
export interface HeldMessageEffect {
  /** The row's name. */
  name: string;
  effects: readonly MessageEffect[];
  action: MessageAction;
  since: number;
  /** The sentence that ends it. */
  until: string;
}

export class MessageTriggers {
  private compiled: Compiled[] = [];
  /** Held effects, by the row's identity so a reload keeps what is still meant. */
  private readonly held = new Map<string, { entry: Compiled; since: number }>();
  private readonly lastResponded = new Map<string, number>();
  private readonly trace: RuleFiring[] = [];

  constructor(
    private readonly queue: CommandQueue,
    private readonly random: () => number = Math.random
  ) {}

  /**
   * Replaces the table. Effects already held stay held when their row is still
   * in the new table, and are let go when it is not — an effect nothing can
   * end any more is one nothing should be waiting on.
   */
  load(triggers: readonly MessageTrigger[]): void {
    this.compiled = triggers
      .filter((trigger) => trigger.enabled && !trigger.chase)
      .map((trigger) => ({
        trigger,
        onset: compileSentence(trigger.match),
        end: trigger.endsWith.length > 0 ? compileSentence(trigger.endsWith) : null,
        lasts:
          trigger.endsWith.length > 0 && (trigger.effects.length > 0 || trigger.action !== 'none')
      }));
    const keys = new Set(this.compiled.map((entry) => identity(entry.trigger)));
    for (const key of [...this.held.keys()]) {
      if (!keys.has(key)) this.held.delete(key);
    }
  }

  /** How many rows are being listened for. */
  get size(): number {
    return this.compiled.length;
  }

  /** What is held now, oldest first. */
  effects(now = Date.now()): HeldMessageEffect[] {
    this.expire(now);
    return [...this.held.values()]
      .sort((a, b) => a.since - b.since)
      .map(({ entry, since }) => ({
        name: entry.trigger.name,
        effects: entry.trigger.effects,
        action: entry.trigger.action,
        since,
        until: entry.trigger.endsWith
      }));
  }

  /** Newest last, like `RuleEngine.firings`. */
  get firings(): RuleFiring[] {
    return [...this.trace];
  }

  /**
   * One line of the realm's, plain text.
   *
   * `conversation` is whether somebody *said* it; `listing` whether it is a
   * line of a sheet or a list the classifier is collecting.
   */
  onLine(line: string, conversation: boolean, listing: boolean, now = Date.now()): void {
    if (this.compiled.length === 0 || listing) return;
    const text = line.trim();
    if (text.length === 0) return;
    this.expire(now);

    for (const [key, { entry }] of [...this.held]) {
      if (entry.end === null || matchSentence(entry.end, text) === null) continue;
      if (conversation && !entry.trigger.conversations) continue;
      this.held.delete(key);
      this.record(now, entry.trigger, [
        t('automation.messages.ended', { effects: this.describe(entry.trigger) })
      ]);
    }

    for (const entry of this.compiled) {
      if (conversation && !entry.trigger.conversations) continue;
      const captures = matchSentence(entry.onset, text);
      if (captures === null) continue;
      this.fire(entry, captures, now);
      return;
    }
  }

  /** Death, or leaving the realm: nothing that was on the character still is. */
  clearEffects(): void {
    this.held.clear();
  }

  reset(): void {
    this.held.clear();
    this.lastResponded.clear();
    this.trace.length = 0;
  }

  private fire(entry: Compiled, captures: Readonly<Record<string, string>>, now: number): void {
    const { trigger } = entry;
    const key = identity(trigger);
    const noted: string[] = [];

    if (entry.lasts) {
      const already = this.held.has(key);
      this.held.set(key, { entry, since: this.held.get(key)?.since ?? now });
      if (!already)
        noted.push(t('automation.messages.started', { effects: this.describe(trigger) }));
    }

    if (trigger.response.length > 0) {
      const last = this.lastResponded.get(key);
      if (last === undefined || now - last >= RESPONSE_GAP_MS) {
        const steps = expandResponse(trigger.response, captures, this.random);
        if (steps.length > 0) this.lastResponded.set(key, now);
        steps.forEach((step, index) => {
          const sent = this.queue.enqueue({
            command: step.command,
            priority: 'combat',
            coalesceKey: `message:${key}:${index}`,
            reason: t('automation.messages.reason', { name: trigger.name }),
            ...(step.delayMs > 0 ? { notBefore: now + step.delayMs } : {})
          });
          if (sent)
            noted.push(step.command.length > 0 ? step.command : t('automation.messages.enter'));
        });
      }
    }

    if (noted.length > 0) this.record(now, trigger, noted);
  }

  private describe(trigger: MessageTrigger): string {
    return trigger.effects.length > 0
      ? trigger.effects.map((effect) => messageEffectLabel(effect, t)).join(', ')
      : trigger.name;
  }

  private record(at: number, trigger: MessageTrigger, commands: string[]): void {
    this.trace.push({
      at,
      rule: t('automation.messages.firing', {
        name: trigger.name.length > 0 ? trigger.name : trigger.match
      }),
      commands
    });
    if (this.trace.length > TRACE_LIMIT) this.trace.shift();
  }

  private expire(now: number): void {
    for (const [key, { since }] of [...this.held]) {
      if (now - since > EFFECT_CEILING_MS) this.held.delete(key);
    }
  }
}

/** A row's identity across reloads: what it listens for and what ends it. */
function identity(trigger: MessageTrigger): string {
  return `${trigger.name}\u0000${trigger.match}\u0000${trigger.endsWith}`;
}
