import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandQueue } from '../CommandQueue';
import { Recovery } from '../Recovery';
import { Regen } from '../Regen';
import {
  DEFAULT_CONFIG,
  type AutomationConfig,
  type HealthConfig,
  type RegenConfig,
  type SpellsConfig
} from '../../../shared/config';
import { EMPTY_CHARACTER, type CharacterState, type StatedEffect } from '../../../shared/character';
import { DEFAULT_INTERNAL } from '../../../shared/internal';

const automation: AutomationConfig = {
  ...DEFAULT_CONFIG.automation,
  enabled: true,
  pacing: { window: 8, minGapMs: 0, ackTimeoutMs: 1000 }
};
const spells = (regen: Partial<RegenConfig> = {}): SpellsConfig => ({
  ...DEFAULT_CONFIG.automation.spells,
  minMana: 0.2,
  regen: { ...DEFAULT_CONFIG.automation.spells.regen, ...regen }
});
const health: HealthConfig = {
  ...DEFAULT_CONFIG.automation.health,
  restBelow: 0.7,
  restTo: 0.9,
  meditateBelow: 0,
  meditateTo: 0.95
};

/** The realm's own row saying regen is working, as `MessageTriggers` holds it. */
const heard = (effect: 'hp-regen' | 'mana-regen'): StatedEffect => ({
  name: effect,
  effects: [effect],
  action: 'none',
  since: 0
});

function state(
  vitals: Partial<CharacterState['vitals']> = {},
  over: Partial<CharacterState> = {}
): CharacterState {
  const base = structuredClone(EMPTY_CHARACTER);
  return {
    ...base,
    phase: 'in-game' as const,
    name: 'Fatty',
    vitals: { ...base.vitals, hp: 500, hpMax: 1000, mana: 100, manaMax: 100, ...vitals },
    ...over
  };
}

let sent: string[];
let queue: CommandQueue;
let clock: number;
beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  clock = Date.now();
  queue = new CommandQueue(automation, { send: (command) => sent.push(command) });
});
afterEach(() => {
  queue.dispose();
  vi.useRealTimers();
});

const make = (regen: Partial<RegenConfig>): Regen =>
  new Regen(
    spells(regen),
    health,
    true,
    queue,
    () => null,
    () => clock
  );

/* Fatty's `RegenCmd=lfst` (fatty.ini, profile 1): the song before the rest. */
describe('HP regen before a rest', () => {
  it('casts it ahead of the rest, and rests on the next line', () => {
    const regen = make({ hp: 'lfst' });
    const recovery = new Recovery(health, true, queue, undefined, {
      beforeRest: (now) => regen.beforeRest(now)
    });
    recovery.onCharacter(state());
    expect(sent).toEqual(['lfst']);
    vi.advanceTimersByTime(DEFAULT_INTERNAL.tuning.rest.askedMs);
    recovery.onCharacter(state());
    expect(sent).toEqual(['lfst', 'rest']);
  });

  it('is not cast again while it is up, nor while the realm says it is working', () => {
    const regen = make({ hp: 'lfst' });
    expect(regen.beforeRest(state())).toBe(true);
    expect(regen.beforeRest(state())).toBe(false);
    expect(make({ hp: 'lfst' }).beforeRest(state({}, { heard: [heard('hp-regen')] }))).toBe(false);
    expect(sent).toEqual(['lfst']);
  });

  it('is cast again once the realm says it has ended', () => {
    const regen = make({ hp: 'lfst' });
    regen.beforeRest(state());
    regen.onCharacter(state({}, { heard: [heard('hp-regen')] }));
    regen.onCharacter(state());
    expect(regen.beforeRest(state())).toBe(true);
    expect(sent).toEqual(['lfst', 'lfst']);
  });

  /*
   * 2026-10-01: skinny-inc has no row for `divine restoration`, and the cast
   * was remembered until health and mana were both full — which a caster
   * hardly ever is — so 73 rests sat down with it ended and no `rsto` first.
   * The spell on the buff list is the realm saying it is up, and its going is
   * the realm saying it has ended.
   */
  it('reads the spell on the buff list as up, and its going as ended', () => {
    const regen = make({ hp: 'divine restoration' });
    const restoring = state(
      {},
      { buffs: [{ spell: 'divine restoration', by: null, appliedAt: 0 }] }
    );
    expect(regen.beforeRest(state())).toBe(true);
    regen.onCharacter(restoring);
    expect(regen.beforeRest(restoring)).toBe(false);
    regen.onCharacter(state());
    expect(regen.beforeRest(state())).toBe(true);
    expect(make({ hp: 'divine restoration' }).beforeRest(restoring)).toBe(false);
    expect(sent).toEqual(['divine restoration', 'divine restoration']);
  });

  /*
   * 2026-10-01: `prfl`, then a `mahe` ahead of every rest, spent each round,
   * and the regen was passed over rather than waited for, so skinny sat down
   * without it every time. The rest waits for the round instead.
   */
  it('holds the rest for a round already spent, and casts when it has passed', () => {
    const regen = make({ hp: 'lfst' });
    let open = false;
    regen.useCastGate({ mayCast: () => open, noteCast: () => {} });
    expect(regen.beforeRest(state())).toBe(true);
    expect(sent).toEqual([]);
    open = true;
    expect(regen.beforeRest(state())).toBe(true);
    expect(sent).toEqual(['lfst']);
    // And nothing to wait for where nothing can be cast.
    const none = make({ hp: '' });
    none.useCastGate({ mayCast: () => false, noteCast: () => {} });
    expect(none.beforeRest(state())).toBe(false);
  });

  /* The exe's thirty-second tick: a regen the realm never ends is forgotten when full. */
  it('is cast again after health and mana have both been full', () => {
    const regen = make({ hp: 'lfst' });
    regen.beforeRest(state());
    regen.onCharacter(state({ hp: 1000 }));
    expect(regen.beforeRest(state())).toBe(true);
  });

  it('waits for the mana a heal is cast at, and for health to be short at all', () => {
    const regen = make({ hp: 'lfst' });
    expect(regen.beforeRest(state({ mana: 10 }))).toBe(false);
    expect(regen.beforeRest(state({ hp: 1000 }))).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('mana regen', () => {
  /* A tick is measured before the first cast (`d834`, never -999). */
  it('is cast out of meditation once mana is 20 short and a tick has been seen', () => {
    const regen = make({ mana: 'flux' });
    expect(regen.onCharacter(state({ mana: 50 }))).toBe(false);
    expect(regen.onCharacter(state({ mana: 53 }))).toBe(true);
    expect(sent).toEqual(['flux']);
    expect(regen.onCharacter(state({ mana: 56 }))).toBe(false);
  });

  it('is not cast while meditating, nor while the realm says it is working', () => {
    const regen = make({ mana: 'flux' });
    regen.onCharacter(state({ mana: 50 }));
    regen.onCharacter(state({ mana: 53, meditating: true }));
    regen.onCharacter(state({ mana: 56 }, { heard: [heard('mana-regen')] }));
    expect(sent).toEqual([]);
  });

  it('is cast again while up when a tick brings less than manaMinTick', () => {
    const regen = make({ mana: 'flux', manaMinTick: 5 });
    regen.onCharacter(state({ mana: 50 }));
    regen.onCharacter(state({ mana: 56 }));
    expect(sent).toEqual(['flux']);
    regen.onCharacter(state({ mana: 62 }));
    expect(sent).toEqual(['flux']);
    regen.onCharacter(state({ mana: 64 }));
    expect(sent).toEqual(['flux', 'flux']);
  });

  it('counts half a minute without a gain as a tick of nothing', () => {
    const regen = make({ mana: 'flux', manaMinTick: 5 });
    regen.onCharacter(state({ mana: 50 }));
    regen.onCharacter(state({ mana: 56 }));
    clock += DEFAULT_INTERNAL.tuning.spells.manaTickWaitMs + 1;
    regen.onCharacter(state({ mana: 56 }));
    expect(sent).toEqual(['flux', 'flux']);
  });

  it('reads a drop as mana spent, not as a slow tick', () => {
    const regen = make({ mana: 'flux', manaMinTick: 5 });
    regen.onCharacter(state({ mana: 50 }));
    regen.onCharacter(state({ mana: 56 }));
    regen.onCharacter(state({ mana: 40 }));
    expect(sent).toEqual(['flux']);
  });
});

describe('when full', () => {
  it('casts once each time health reaches restTo and mana meditateTo', () => {
    const regen = make({ hpFull: 'swan', manaFull: 'wisd' });
    regen.onCharacter(state({ hp: 950, mana: 96 }));
    regen.onCharacter(state({ hp: 950, mana: 96 }));
    regen.onCharacter(state({ hp: 950, mana: 96 }));
    expect(sent).toEqual(['wisd', 'swan']);
    regen.onCharacter(state({ hp: 800, mana: 96 }));
    regen.onCharacter(state({ hp: 950, mana: 96 }));
    expect(sent).toEqual(['wisd', 'swan', 'swan']);
  });

  it('casts nothing in a fight', () => {
    const regen = make({ hpFull: 'swan' });
    const fighting = structuredClone(EMPTY_CHARACTER).combat;
    regen.onCharacter(
      state({ hp: 1000 }, { inCombat: true, combat: { ...fighting, target: 'giant rat' } })
    );
    expect(sent).toEqual([]);
  });
});
