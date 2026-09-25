/*
 * The staleness table's halves, held to each other.
 *
 * `StaleFact` is a closed union with two halves that have to move together —
 * the word, and the command it names in `REFRESH` — and a member added to the
 * type without a command type-checks, loads, and then refreshes nothing. That
 * is `GUARD_FIELDS`' own lesson (a field in the type and the reader but not the
 * list, whose only symptom is a rule that never fires) applied to the other
 * closed union in `shared/`.
 *
 * And the block half is checked in the same direction the vocabulary test
 * checks patterns: a fact nothing ever makes stale is a command nothing will
 * ever send, which is the dead-branch case wearing another face.
 */
import { describe, expect, it } from 'vitest';

import { domainOf } from '../blocks';
import { EMPTY_CHARACTER } from '../character';
import {
  READ,
  REFRESH,
  REQUIRED,
  STALE_AFTER,
  staleAfter,
  unread,
  type StaleFact
} from '../staleness';

const FACTS: readonly StaleFact[] = ['sheet', 'experience', 'pack'];

describe('what a sentence made stale', () => {
  it('names a command for every fact in the union', () => {
    for (const fact of FACTS) {
      expect(REFRESH[fact]?.command, fact).toBeTruthy();
    }
    expect(Object.keys(REFRESH).sort()).toEqual([...FACTS].sort());
  });

  /*
   * The key the entry probe already builds (`probe:${command}`), so a refresh
   * and an entry probe for the same command are one intent. Two `st`s a second
   * apart is a command spent to be told what the first is on its way back with.
   */
  it('coalesces onto the entry probe’s own key for the command', () => {
    for (const fact of FACTS) {
      expect(REFRESH[fact].coalesceKey).toBe(`probe:${REFRESH[fact].command}`);
    }
  });

  it('makes something stale for every fact, so no command is unreachable', () => {
    const named = new Set(Object.values(STALE_AFTER).flatMap((facts) => [...(facts ?? [])]));
    expect([...named].sort()).toEqual([...FACTS].sort());
  });

  it('is keyed by block types the vocabulary declares', () => {
    for (const type of Object.keys(STALE_AFTER)) {
      expect(domainOf(type as never), type).toBeTruthy();
    }
  });

  /* Absent is "nothing went stale", never a crash and never everything. */
  it('answers a sentence that invalidated nothing with nothing', () => {
    expect(staleAfter('room-name')).toEqual([]);
    expect(staleAfter('user-levels')).toEqual(['sheet', 'experience']);
  });
});

/*
 * The facts asked for until read (2026-09-25): skinny entered the realm on
 * the ground, the entry probe's `st` never went out, and every health figure
 * read "unknown, so not low" while he walked a route at 17%.
 */
describe('what has not been read', () => {
  it('says how every fact is read and which listing answers it', () => {
    expect(Object.keys(READ).sort()).toEqual([...FACTS].sort());
    for (const fact of FACTS) expect(domainOf(READ[fact].answeredBy), fact).toBeTruthy();
  });

  it('requires the sheet and the pack', () => {
    expect([...REQUIRED].sort()).toEqual(['pack', 'sheet']);
    expect(unread(EMPTY_CHARACTER)).toEqual(['sheet', 'pack']);
  });

  it('reads each off the state, never off having asked', () => {
    const seen = {
      ...EMPTY_CHARACTER,
      vitals: { ...EMPTY_CHARACTER.vitals, hpMax: 649 },
      inventory: { ...EMPTY_CHARACTER.inventory, listedAt: 1 }
    };
    expect(unread(seen)).toEqual([]);
    // Carrying nothing is read; nobody having looked is not.
    expect(
      unread({ ...seen, inventory: { ...seen.inventory, items: [], listedAt: null } })
    ).toEqual(['pack']);
  });
});
