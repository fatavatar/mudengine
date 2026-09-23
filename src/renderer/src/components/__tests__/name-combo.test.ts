import { describe, expect, it } from 'vitest';

import { comboFor } from '../NameCombo';

const MOBS = ['giant rat', 'gigantic black ooze', 'kobold thief', 'wererat shaman'];

describe('a name picker', () => {
  it('suggests by prefix first, then anywhere in the name', () => {
    expect(comboFor(MOBS, 'rat').suggestions).toEqual(['giant rat', 'wererat shaman']);
    expect(comboFor(MOBS, 'gi').suggestions).toEqual(['giant rat', 'gigantic black ooze']);
  });

  it('replaces the whole value with a choice', () => {
    expect(comboFor(MOBS, 'gi').choose('giant rat')).toBe('giant rat');
  });
});

/* The avoid list: names, comma-separated, completed one at a time. */
describe('a list of names in one field', () => {
  it('suggests for the name after the last comma', () => {
    expect(comboFor(MOBS, 'giant rat, kob', ',').suggestions).toEqual(['kobold thief']);
  });

  it('does not offer a name already written', () => {
    expect(comboFor(MOBS, 'giant rat, g', ',').suggestions).toEqual(['gigantic black ooze']);
  });

  it('puts a choice in place of the name being typed and keeps the rest', () => {
    expect(comboFor(MOBS, 'giant rat, kob', ',').choose('kobold thief')).toBe(
      'giant rat, kobold thief'
    );
    expect(comboFor(MOBS, 'kob', ',').choose('kobold thief')).toBe('kobold thief');
  });
});
