import { describe, expect, it } from 'vitest';

import {
  asMessageTable,
  compileSentence,
  expandResponse,
  matchSentence,
  parseMegaMudMessages,
  triggerForFile
} from '../messageTriggers';

/** Records copied from MegaMUD 2.1's shipped `Default/Messages.md`, CRLF and all. */
const FILE = [
  '1 life left:0000:0:.LOW ON LIVES!^M',
  'You have 1 lives left.',
  '',
  'acid rain:0008:0:',
  'You are covered in acid',
  'The acid covering you dries up',
  'Afraid:2002:0:',
  'You are too afraid to do that!',
  '',
  'chase (alley):4000:0:go alley',
  '{target} slips into the dark alley.',
  '',
  'confusion:0002:2:',
  'You are confused',
  'The effects of confusion wear off',
  'desert damage:0000:5:drink water',
  'You suffer in the desert heat...',
  '',
  'brain eater:1400:0:^M',
  'and a small creature leaps out!',
  '',
  'web:0013:2:',
  'You are caught in a cocoon!',
  'You break free of the cocoon',
  ''
].join('\r\n');

describe('parseMegaMudMessages', () => {
  const { triggers, skipped } = parseMegaMudMessages(FILE);

  it('reads every three-line record', () => {
    expect(skipped).toEqual([]);
    expect(triggers.map((trigger) => trigger.name)).toEqual([
      '1 life left',
      'acid rain',
      'Afraid',
      'chase (alley)',
      'confusion',
      'desert damage',
      'brain eater',
      'web'
    ]);
  });

  it('keeps the response, colons and carets included', () => {
    expect(triggers[0]).toMatchObject({
      match: 'You have 1 lives left.',
      endsWith: '',
      response: '.LOW ON LIVES!^M'
    });
  });

  it("reads the flag word with MegaMUD's own bit layout", () => {
    expect(triggers[1]!.effects).toEqual(['losing-hp']);
    expect(triggers[2]!.effects).toEqual(['confused', 'action-failed']);
    // 0x0013: blinded, confused and movement prevented.
    expect(triggers[7]!.effects).toEqual(['blind', 'confused', 'held']);
    expect(triggers[3]!.chase).toBe(true);
    // 0x1400: ends combat, and found anywhere in the text.
    expect(triggers[6]).toMatchObject({ effects: ['ends-combat'], anywhere: true });
  });

  it('reads the action index in radio order', () => {
    expect(triggers[4]!.action).toBe('wait');
    expect(triggers[5]!.action).toBe('run');
    expect(triggers[0]!.action).toBe('none');
  });

  it('reports a line that is not a header rather than resynchronising silently', () => {
    const result = parseMegaMudMessages('stray text\r\nok:0000:0:\r\nYou are ok\r\n\r\n');
    expect(result.skipped).toEqual([{ line: 1, why: 'not-a-header' }]);
    expect(result.triggers).toHaveLength(1);
  });

  it('skips a record with no sentence', () => {
    const result = parseMegaMudMessages('empty:0000:0:\r\n\r\n\r\n');
    expect(result.triggers).toEqual([]);
    expect(result.skipped).toEqual([{ line: 1, why: 'no-message' }]);
  });

  it('keeps the disabled bit as a disabled trigger', () => {
    const result = parseMegaMudMessages('off:8000:0:\r\nYou are off\r\n\r\n');
    expect(result.triggers[0]!.enabled).toBe(false);
  });
});

describe('the realm file', () => {
  it('round-trips a trigger through the compact form it writes', () => {
    const { triggers } = parseMegaMudMessages(FILE);
    const table = asMessageTable({
      source: { file: 'Messages.md', importedAt: '2026-09-22T00:00:00.000Z' },
      messages: triggers.map(triggerForFile)
    });
    expect(table.triggers).toEqual(triggers);
    expect(table.source?.file).toBe('Messages.md');
  });

  it('writes only what differs from a blank trigger', () => {
    const { triggers } = parseMegaMudMessages(FILE);
    expect(triggerForFile(triggers[1]!)).toEqual({
      name: 'acid rain',
      match: 'You are covered in acid',
      endsWith: 'The acid covering you dries up',
      effects: ['losing-hp']
    });
  });

  it('drops a row with no sentence and an effect it does not know', () => {
    const table = asMessageTable({
      messages: [{ name: 'x' }, { match: 'You feel odd', effects: ['blind', 'sparkly'] }]
    });
    expect(table.triggers).toHaveLength(1);
    expect(table.triggers[0]!.effects).toEqual(['blind']);
  });
});

describe('matching a sentence', () => {
  it('finds a plain sentence anywhere in the line', () => {
    const compiled = compileSentence('flays you viciously');
    expect(matchSentence(compiled, 'The wererat flays you viciously!')).toEqual({});
    expect(matchSentence(compiled, 'The wererat bites you.')).toBeNull();
  });

  it('is case-sensitive, as MegaMUD is', () => {
    expect(matchSentence(compileSentence('You are confused'), 'you are confused')).toBeNull();
  });

  it('captures a leading name from the start of the line', () => {
    const compiled = compileSentence('{target} slips into the dark alley.');
    expect(matchSentence(compiled, 'Soul Reaver slips into the dark alley.')).toEqual({
      target: 'Soul Reaver'
    });
  });

  it('captures damage as digits only', () => {
    const compiled = compileSentence('You take {dmg} from the poisonous swamp');
    expect(matchSentence(compiled, 'You take 12 from the poisonous swamp!')).toEqual({ dmg: '12' });
    expect(matchSentence(compiled, 'You take lots from the poisonous swamp!')).toBeNull();
  });

  it('lets a trailing token take the rest of the line', () => {
    const compiled = compileSentence('You lay hands on {target}');
    expect(matchSentence(compiled, 'You lay hands on Naji Hollow.')).toEqual({
      target: 'Naji Hollow.'
    });
  });

  it('treats regex characters in the sentence as literal text', () => {
    const compiled = compileSentence('You suffer in the desert heat...');
    expect(matchSentence(compiled, 'You suffer in the desert heat...')).toEqual({});
    expect(matchSentence(compiled, 'You suffer in the desert heatxyz')).toBeNull();
  });
});

describe('expanding a response', () => {
  it('sends a bare Enter for ^M alone', () => {
    expect(expandResponse('^M', {})).toEqual([{ command: '', delayMs: 0 }]);
  });

  it('splits commands on ^M and sends a last one with no ^M after it', () => {
    expect(expandResponse('.LOW ON LIVES!^M=x', {})).toEqual([
      { command: '.LOW ON LIVES!', delayMs: 0 },
      { command: '=x', delayMs: 0 }
    ]);
    expect(expandResponse('drink water', {})).toEqual([{ command: 'drink water', delayMs: 0 }]);
  });

  it('delays what follows a ~ by half a second each', () => {
    expect(expandResponse('rem ring^M~~wear ring^M', {})).toEqual([
      { command: 'rem ring', delayMs: 0 },
      { command: 'wear ring', delayMs: 1000 }
    ]);
  });

  it('picks one alternative, and an empty one sends nothing', () => {
    expect(expandResponse('hi||hello||', {}, () => 0)).toEqual([{ command: 'hi', delayMs: 0 }]);
    expect(expandResponse('hi||hello||', {}, () => 0.5)).toEqual([
      { command: 'hello', delayMs: 0 }
    ]);
    expect(expandResponse('hi||hello||', {}, () => 0.99)).toEqual([]);
  });

  it('substitutes what the sentence captured', () => {
    expect(expandResponse('cast heal {target}^M', { target: 'Naji' })).toEqual([
      { command: 'cast heal Naji', delayMs: 0 }
    ]);
  });

  it('never substitutes the account', () => {
    expect(expandResponse('say {pswd}', {})).toEqual([{ command: 'say {pswd}', delayMs: 0 }]);
  });

  it('reads the escaped literals', () => {
    expect(expandResponse('say a^|b ^~ c^^', {})).toEqual([
      { command: 'say a|b ~ c^', delayMs: 0 }
    ]);
  });
});
