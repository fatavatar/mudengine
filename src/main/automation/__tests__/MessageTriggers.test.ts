import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandQueue } from '../CommandQueue';
import { MessageTriggers } from '../MessageTriggers';
import { DEFAULT_CONFIG } from '../../../shared/config';
import { blankTrigger, type MessageTrigger } from '../../../shared/messageTriggers';

function row(patch: Partial<MessageTrigger>): MessageTrigger {
  return { ...blankTrigger(), ...patch };
}

let sent: string[];
let queue: CommandQueue;
let messages: MessageTriggers;

function build(enabled = true): void {
  queue?.dispose();
  queue = new CommandQueue(
    {
      ...DEFAULT_CONFIG.automation,
      enabled,
      pacing: { window: 8, minGapMs: 0, ackTimeoutMs: 1000 }
    },
    { send: (command) => sent.push(command) }
  );
  messages = new MessageTriggers(queue, () => 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  build();
});

afterEach(() => {
  queue.dispose();
  vi.useRealTimers();
});

describe('responses', () => {
  it('sends the response when its sentence arrives anywhere in a line', () => {
    messages.load([
      row({
        name: 'desert damage',
        match: 'You suffer in the desert heat...',
        response: 'drink water'
      })
    ]);
    messages.onLine('You suffer in the desert heat...', false, false);
    expect(sent).toEqual(['drink water']);
  });

  it('sends a bare Enter for ^M', () => {
    messages.load([
      row({ name: 'sounds', match: 'A dog barks off in the distance.', response: '^M' })
    ]);
    messages.onLine('A dog barks off in the distance.', false, false);
    expect(sent).toEqual(['']);
  });

  it('substitutes what the sentence captured', () => {
    messages.load([row({ match: '{target} waves at you.', response: 'wave {target}^M' })]);
    messages.onLine('Naji waves at you.', false, false);
    expect(sent).toEqual(['wave Naji']);
  });

  it('holds what follows a ~ until its time', () => {
    messages.load([
      row({ match: 'You feel your life-force ebbing.', response: 'say help^M~~st^M' })
    ]);
    messages.onLine('You feel your life-force ebbing.', false, false);
    expect(sent).toEqual(['say help']);
    vi.advanceTimersByTime(999);
    expect(sent).toEqual(['say help']);
    vi.advanceTimersByTime(20);
    expect(sent).toEqual(['say help', 'st']);
  });

  it('answers only the first row that matches', () => {
    messages.load([
      row({ name: 'stunned', match: 'You are stunned', response: 'one' }),
      row({ name: 'song of stunning', match: 'You are stunned', response: 'two' })
    ]);
    messages.onLine('You are stunned!', false, false);
    expect(sent).toEqual(['one']);
  });

  it('does not answer a conversation, unless the row says to', () => {
    messages.load([
      row({ match: 'You are confused', response: 'rest' }),
      row({ match: 'heal me', response: 'cast heal', conversations: true })
    ]);
    messages.onLine('Vex gossips: You are confused', true, false);
    expect(sent).toEqual([]);
    messages.onLine('Vex says "heal me"', true, false);
    expect(sent).toEqual(['cast heal']);
  });

  it('does not answer a line inside a listing', () => {
    messages.load([row({ match: 'You awaken from unnatural slumber.', response: 'st' })]);
    messages.onLine('You awaken from unnatural slumber.', false, true);
    expect(sent).toEqual([]);
  });

  it('answers one row at most once a second', () => {
    messages.load([row({ match: 'A dog barks', response: '^M' })]);
    messages.onLine('A dog barks', false, false, 1_000);
    messages.onLine('A dog barks', false, false, 1_500);
    messages.onLine('A dog barks', false, false, 2_100);
    expect(sent).toEqual(['', '']);
  });

  it('never answers a switched-off row or a chase row', () => {
    messages.load([
      row({ match: 'You are off', response: 'x', enabled: false }),
      row({ match: '{target} slips into the dark alley.', response: 'go alley', chase: true })
    ]);
    messages.onLine('You are off', false, false);
    messages.onLine('Naji slips into the dark alley.', false, false);
    expect(sent).toEqual([]);
    expect(messages.size).toBe(0);
  });

  it('sends nothing with automation off, as MegaMUD sends nothing all-off', () => {
    build(false);
    messages.load([row({ match: 'You suffer in the desert heat...', response: 'drink water' })]);
    messages.onLine('You suffer in the desert heat...', false, false);
    expect(sent).toEqual([]);
    expect(messages.firings).toEqual([]);
  });
});

describe('effects', () => {
  const confusion = row({
    name: 'confusion',
    match: 'You are confused',
    endsWith: 'The effects of confusion wear off',
    effects: ['confused'],
    action: 'wait'
  });

  it('holds an effect from its sentence until the one that ends it', () => {
    messages.load([confusion]);
    messages.onLine('You are confused!', false, false, 5_000);
    expect(messages.effects(5_000)).toEqual([
      {
        name: 'confusion',
        effects: ['confused'],
        action: 'wait',
        since: 5_000,
        until: 'The effects of confusion wear off'
      }
    ]);
    messages.onLine('The effects of confusion wear off!', false, false, 9_000);
    expect(messages.effects(9_000)).toEqual([]);
  });

  it('keeps the first onset time when the sentence repeats', () => {
    messages.load([confusion]);
    messages.onLine('You are confused!', false, false, 1_000);
    messages.onLine('You are confused!', false, false, 4_000);
    expect(messages.effects(4_000)[0]!.since).toBe(1_000);
  });

  it('lets go of an effect nothing ended after ten minutes', () => {
    messages.load([confusion]);
    messages.onLine('You are confused!', false, false, 0);
    expect(messages.effects(10 * 60_000 + 1)).toEqual([]);
  });

  it('does not hold a sentence with no ending, or one that means nothing', () => {
    messages.load([
      row({ match: 'You retch uncontrollably!', effects: ['action-failed'] }),
      row({ match: 'You feel protected', endsWith: 'The protection fades' })
    ]);
    messages.onLine('You retch uncontrollably!', false, false);
    messages.onLine('You feel protected', false, false);
    expect(messages.effects()).toEqual([]);
  });

  it('forgets every effect on a death', () => {
    messages.load([confusion]);
    messages.onLine('You are confused!', false, false);
    messages.clearEffects();
    expect(messages.effects()).toEqual([]);
  });

  it('keeps an effect across a reload that keeps its row, and drops one that does not', () => {
    messages.load([confusion]);
    messages.onLine('You are confused!', false, false);
    messages.load([confusion, row({ match: 'Something else' })]);
    expect(messages.effects()).toHaveLength(1);
    messages.load([row({ match: 'Something else' })]);
    expect(messages.effects()).toEqual([]);
  });

  it('traces the start, the reply and the end', () => {
    messages.load([{ ...confusion, response: 'rest^M' }]);
    messages.onLine('You are confused!', false, false, 1_000);
    messages.onLine('The effects of confusion wear off', false, false, 2_000);
    expect(messages.firings).toEqual([
      { at: 1_000, rule: 'Message: confusion', commands: ['Confused begins', 'rest'] },
      { at: 2_000, rule: 'Message: confusion', commands: ['Confused over'] }
    ]);
  });
});
