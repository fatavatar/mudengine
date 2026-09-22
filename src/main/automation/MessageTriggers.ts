/**
 * A realm's message triggers, running: a sentence arrives, and what the realm's
 * table says about it happens.
 *
 * Three things:
 *
 * - **Responses are sent.** `drink water` in the desert, a bare Enter after
 *   an ambient sentence so the room is drawn again, `.LOW ON LIVES!` — each
 *   through `CommandQueue`, like everything automated, at `combat` priority so
 *   an answer to the realm goes ahead of the next step of a walk.
 * - **Effects are held and published.** A sentence with an `endsWith` starts
 *   something that lasts until that sentence arrives, and a row that says to
 *   rest until full lasts until the session says the figure is full
 *   (`release`). What is held goes onto the character (`events.stated`,
 *   `CharacterState.stated`), where the modules that already own each
 *   decision read it: the walk waits, the fight holds, a cure is cast. What
 *   is a moment rather than a state — a fight the realm ended, a command it
 *   refused, a look, a hang-up — is handed to the session (`events.fired`).
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
import type { StatedEffect } from '../../shared/character';
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
  /** Whether a match starts something worth holding. */
  lasts: boolean;
}

/**
 * The actions that last until the character is *full* rather than until a
 * sentence: MegaMUD's *rest until full HP's* and *rest until full mana*. They
 * are held like an effect so the walk waits and the rest is taken, and let go
 * by `release` when the figure is reached.
 */
const RESTS: readonly MessageAction[] = ['rest-hp', 'rest-mana'];

export interface MessageTriggersEvents {
  /**
   * What is held changed: the whole list now, and the effects that have just
   * started and just ended. The tracker publishes it (`noteStated`).
   */
  stated?(held: readonly StatedEffect[], started: MessageEffect[], ended: MessageEffect[]): void;
  /**
   * A row matched. For what is not a state but a moment — a fight the realm
   * ended, a command it refused, a look, a hang-up — which the session acts
   * on, because each of those belongs to a module this one does not own.
   */
  fired?(trigger: MessageTrigger): void;
}

export class MessageTriggers {
  private compiled: Compiled[] = [];
  /** Held effects, by the row's identity so a reload keeps what is still meant. */
  private readonly held = new Map<string, { entry: Compiled; stated: StatedEffect }>();
  private readonly lastResponded = new Map<string, number>();
  private readonly trace: RuleFiring[] = [];

  constructor(
    private readonly queue: CommandQueue,
    private readonly random: () => number = Math.random,
    private readonly events: MessageTriggersEvents = {}
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
          RESTS.includes(trigger.action) ||
          (trigger.endsWith.length > 0 && (trigger.effects.length > 0 || trigger.action !== 'none'))
      }));
    const keys = new Set(this.compiled.map((entry) => identity(entry.trigger)));
    this.drop((key) => !keys.has(key));
  }

  /** How many rows are being listened for. */
  get size(): number {
    return this.compiled.length;
  }

  /** What is held now, oldest first. */
  effects(now = Date.now()): StatedEffect[] {
    this.expire(now);
    return this.list();
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

    const ended: MessageEffect[] = [];
    for (const [key, { entry }] of [...this.held]) {
      if (entry.end === null || matchSentence(entry.end, text) === null) continue;
      if (conversation && !entry.trigger.conversations) continue;
      this.held.delete(key);
      ended.push(...entry.trigger.effects);
      this.record(now, entry.trigger, [
        t('automation.messages.ended', { effects: this.describe(entry.trigger) })
      ]);
    }

    let started: MessageEffect[] = [];
    let fired: MessageTrigger | null = null;
    for (const entry of this.compiled) {
      if (conversation && !entry.trigger.conversations) continue;
      const captures = matchSentence(entry.onset, text);
      if (captures === null) continue;
      started = this.fire(entry, captures, now);
      fired = entry.trigger;
      break;
    }

    if (started.length > 0 || ended.length > 0 || this.changed) this.announce(started, ended);
    if (fired !== null) this.events.fired?.(fired);
  }

  /**
   * Lets go of every held row this says is over — a rest to full that has
   * reached full. Returns whether anything was let go.
   */
  release(done: (effect: StatedEffect) => boolean, now = Date.now()): boolean {
    const ended: MessageEffect[] = [];
    let any = false;
    for (const [key, { entry, stated }] of [...this.held]) {
      if (!done(stated)) continue;
      this.held.delete(key);
      ended.push(...entry.trigger.effects);
      any = true;
      this.record(now, entry.trigger, [
        t('automation.messages.ended', { effects: this.describe(entry.trigger) })
      ]);
    }
    if (any) this.announce([], ended);
    return any;
  }

  /** Death, or leaving the realm: nothing that was on the character still is. */
  clearEffects(): void {
    this.drop(() => true);
  }

  reset(): void {
    this.held.clear();
    this.changed = false;
    this.lastResponded.clear();
    this.trace.length = 0;
  }

  /** Whether `held` changed in a way `announce` has not told anybody yet. */
  private changed = false;

  /** Returns the effects this match started, which are none if it was already held. */
  private fire(
    entry: Compiled,
    captures: Readonly<Record<string, string>>,
    now: number
  ): MessageEffect[] {
    const { trigger } = entry;
    const key = identity(trigger);
    const noted: string[] = [];
    let started: MessageEffect[] = [];

    if (entry.lasts && !this.held.has(key)) {
      this.held.set(key, {
        entry,
        stated: { name: trigger.name, effects: trigger.effects, action: trigger.action, since: now }
      });
      this.changed = true;
      started = [...trigger.effects];
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
    return started;
  }

  private list(): StatedEffect[] {
    return [...this.held.values()].map(({ stated }) => stated).sort((a, b) => a.since - b.since);
  }

  private announce(started: MessageEffect[], ended: MessageEffect[]): void {
    this.changed = false;
    this.events.stated?.(this.list(), started, ended);
  }

  private drop(which: (key: string) => boolean): void {
    const ended: MessageEffect[] = [];
    let any = false;
    for (const [key, { entry }] of [...this.held]) {
      if (!which(key)) continue;
      this.held.delete(key);
      ended.push(...entry.trigger.effects);
      any = true;
    }
    if (any) this.announce([], ended);
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
    const ended: MessageEffect[] = [];
    for (const [key, { entry, stated }] of [...this.held]) {
      if (now - stated.since <= EFFECT_CEILING_MS) continue;
      this.held.delete(key);
      ended.push(...entry.trigger.effects);
      this.changed = true;
    }
    if (ended.length > 0) this.announce([], ended);
  }
}

/** A row's identity across reloads: what it listens for and what ends it. */
function identity(trigger: MessageTrigger): string {
  return `${trigger.name}\u0000${trigger.match}\u0000${trigger.endsWith}`;
}
