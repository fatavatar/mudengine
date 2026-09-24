import { describe, expect, it } from 'vitest';

import { answerQueries, columnAfter } from '../terminal-queries';

// The opening of skinny's login on 2026-09-24, as the BBS sends it.
const AUTO_SENSE = 'Auto-sensing...\r\n    \x1b[6n\b\b\b\b\r    ';

describe('the cursor question', () => {
  it('is answered with the last row and the column after what came before it', () => {
    expect(answerQueries(AUTO_SENSE, 0, 24).replies).toEqual(['\x1b[24;5R']);
  });

  it('counts from where the last chunk left the cursor', () => {
    expect(answerQueries('ab\x1b[6n', 3, 24).replies).toEqual(['\x1b[24;6R']);
  });

  it('answers each time it is asked', () => {
    expect(answerQueries('\x1b[6nabc\x1b[6n', 0, 24).replies).toEqual(['\x1b[24;1R', '\x1b[24;4R']);
  });

  it('says it is well when asked that', () => {
    expect(answerQueries('\x1b[5n', 0, 24).replies).toEqual(['\x1b[0n']);
  });

  it('is not heard in ordinary output', () => {
    expect(answerQueries('\x1b[1;32mnothing asked\x1b[0m\r\n', 0, 24)).toEqual({
      replies: [],
      column: 0
    });
  });
});

describe('the column', () => {
  it('starts again after a line break', () => {
    expect(columnAfter(7, 'abc\r\nde')).toBe(2);
  });

  it('carries on without one', () => {
    expect(columnAfter(7, 'de')).toBe(9);
  });

  it('takes nothing for colour and steps back for a backspace', () => {
    expect(columnAfter(0, '\x1b[1;31mabcd\b\b\x1b[0m')).toBe(2);
  });
});
