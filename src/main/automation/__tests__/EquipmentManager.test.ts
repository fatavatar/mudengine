import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EquipmentManager, type EquipmentSources } from '../EquipmentManager';
import { CommandQueue } from './../CommandQueue';
import { EMPTY_CHARACTER, type CarriedItem, type CharacterState } from '../../../shared/character';
import { DEFAULT_CONFIG, type AutomationConfig, type GearConfig } from '../../../shared/config';
import { wireItem } from '../../../shared/entities';
import { OFF_HAND, WEAPON_HAND } from '../../../shared/items';
import type { GearSet } from '../../../shared/gear';

const automation: AutomationConfig = {
  ...DEFAULT_CONFIG.automation,
  enabled: true,
  pacing: { window: 8, minGapMs: 0, ackTimeoutMs: 1000 }
};

/*
 * The report's own example, verbatim in shape: plate boots while fighting,
 * brown leather boots while walking, and one boss the lap otherwise fights
 * with what the base set holds.
 */
const SETS: GearSet[] = [
  { name: 'Default', when: 'always', mob: '', wear: ['plate boots', 'lifestealer'] },
  { name: 'Moving', when: 'moving', mob: '', wear: ['brown leather boots'] },
  { name: 'Boss', when: 'fighting', mob: 'nasty sandworm', wear: ['nexus spear'] }
];

const SLOTS: Record<string, string> = {
  'plate boots': 'Feet',
  'brown leather boots': 'Feet',
  lifestealer: WEAPON_HAND,
  'nexus spear': WEAPON_HAND,
  'golden chalice': OFF_HAND
};

const gear = (over: Partial<GearConfig> = {}): GearConfig => ({
  ...DEFAULT_CONFIG.automation.gear,
  enabled: true,
  sets: SETS,
  ...over
});

const carried = (name: string): CarriedItem => ({ ...wireItem(name) });
const worn = (name: string, slot: string): CarriedItem => ({
  ...wireItem(name),
  slot,
  equipped: true
});

function standing(items: CarriedItem[], over: Partial<CharacterState> = {}): CharacterState {
  const base = structuredClone(EMPTY_CHARACTER);
  return {
    ...base,
    phase: 'in-game' as const,
    inventory: { ...base.inventory, items, listedAt: 1_000 },
    ...over
  };
}

const fighting = (target: string | null, items: CarriedItem[]): CharacterState =>
  standing(items, {
    inCombat: true,
    combat: { ...structuredClone(EMPTY_CHARACTER).combat, target }
  });

let sent: string[];
let notices: string[];
let queue: CommandQueue;
let clock: number;

const sources = (over: Partial<EquipmentSources> = {}): EquipmentSources => ({
  slotOf: (name) => SLOTS[name] ?? null,
  handsOf: (name) => (name === 'nexus spear' ? 2 : 1),
  ...over
});

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  notices = [];
  clock = Date.now();
  queue = new CommandQueue(automation, { send: (command) => sent.push(command) });
});

afterEach(() => {
  queue.dispose();
  vi.useRealTimers();
});

const make = (config = gear(), over: Partial<EquipmentSources> = {}): EquipmentManager =>
  new EquipmentManager(
    config,
    true,
    queue,
    sources(over),
    { notice: (message) => notices.push(message) },
    () => clock
  );

describe('which kit to be in', () => {
  /*
   * Skinny's kit (2026-09-30): the staff to rest in, the warhammer to fight
   * in. Putting a weapon on ends a fight here, so it goes on before one opens.
   */
  it('puts the fighting kit on for a fight about to open, and not before', () => {
    const sets: GearSet[] = [
      { name: 'Rest Set', when: 'resting', mob: '', wear: ['vortex staff'] },
      { name: 'Normal Set', when: 'fighting', mob: '', wear: ['jewel-encrusted warhammer'] }
    ];
    const hands = { slotOf: () => WEAPON_HAND };
    const pack = [worn('vortex staff', WEAPON_HAND), carried('jewel-encrusted warhammer')];
    const manager = make(gear({ sets }), hands);
    manager.onCharacter(standing(pack), false, null);
    expect(sent).toEqual([]);
    manager.onCharacter(standing(pack), false, null, true);
    expect(sent).toEqual(['wear jewel-encrusted warhammer']);
    expect(manager.dressing).toBe(true);
  });

  it('puts the base kit on with nothing else happening', () => {
    make().onCharacter(standing([carried('plate boots'), carried('lifestealer')]), false, null);
    expect(sent).toEqual(['wear lifestealer', 'wear plate boots']);
  });

  it('swaps only the slot a moving set names, leaving the rest of the base alone', () => {
    const pack = [
      worn('plate boots', 'Feet'),
      worn('lifestealer', WEAPON_HAND),
      carried('brown leather boots')
    ];
    make().onCharacter(standing(pack), true, null);
    expect(sent).toEqual(['wear brown leather boots']);
  });

  /*
   * The two-handed dance, driven by the situation rather than by a press: the
   * boss row's weapon needs the hand the chalice is in.
   */
  it('takes the off-hand off for the boss set’s two-handed weapon', () => {
    const pack = [
      worn('golden chalice', OFF_HAND),
      worn('lifestealer', WEAPON_HAND),
      worn('plate boots', 'Feet'),
      carried('nexus spear')
    ];
    make().onCharacter(fighting('nasty sandworm', pack), false, null);
    expect(sent).toEqual(['remove golden chalice', 'wear nexus spear']);
  });

  it('leaves another monster to the base kit', () => {
    const pack = [
      worn('lifestealer', WEAPON_HAND),
      worn('plate boots', 'Feet'),
      carried('nexus spear')
    ];
    make().onCharacter(fighting('big sandworm', pack), false, null);
    expect(sent).toEqual([]);
  });

  it('sends nothing with the switch off, or off an unread pack', () => {
    const pack = [carried('plate boots'), carried('lifestealer')];
    make(gear({ enabled: false })).onCharacter(standing(pack), false, null);
    const unread = standing(pack);
    make().onCharacter(
      { ...unread, inventory: { ...unread.inventory, listedAt: null } },
      false,
      null
    );
    expect(sent).toEqual([]);
  });

  /* The retry floor: a `wear` the server swallowed is not resent per line. */
  it('does not repeat a command on every status line', () => {
    const manager = make();
    const state = standing([carried('plate boots'), carried('lifestealer')]);
    manager.onCharacter(state, false, null);
    manager.onCharacter(state, false, null);
    expect(sent).toEqual(['wear lifestealer', 'wear plate boots']);
  });

  /*
   * And the floor is the *situation's*, not the clock's: a character that
   * fights, walks and fights again inside half a minute must not have the
   * second swap refused by the first one's retry floor.
   */
  it('sends again when the situation changes back inside the retry floor', () => {
    const manager = make();
    const pack = [
      worn('plate boots', 'Feet'),
      worn('lifestealer', WEAPON_HAND),
      carried('brown leather boots')
    ];
    manager.onCharacter(standing(pack), true, null);
    expect(sent).toEqual(['wear brown leather boots']);
    // Now walking with the leather boots on, and the base wants the plate back.
    const after = [
      worn('brown leather boots', 'Feet'),
      worn('lifestealer', WEAPON_HAND),
      carried('plate boots')
    ];
    manager.onCharacter(standing(after), false, null);
    expect(sent).toEqual(['wear brown leather boots', 'wear plate boots']);
  });

  /*
   * Skinny, 2026-10-03: the situation flipped twice before the server answered,
   * and every flip sent the `wear`s again — `wear firestone pendant` three
   * times in one second. A command on its way is not asked for twice.
   */
  it('does not send a swap again while the first is still unanswered', () => {
    const manager = make();
    const pack = [
      worn('plate boots', 'Feet'),
      worn('lifestealer', WEAPON_HAND),
      carried('brown leather boots')
    ];
    manager.onCharacter(standing(pack), true, null);
    manager.onCharacter(standing(pack), false, null);
    manager.onCharacter(standing(pack), true, null);
    expect(sent).toEqual(['wear brown leather boots']);
  });

  /*
   * Fatty's Pre/Post Rest commands, `eq healing stone` and `eq ruby-eyed
   * amulet` (fatty.ini): the stone and the amulet share the neck, so the base
   * set naming the amulet is what brings it back.
   */
  it('wears the resting set while sitting and the base again for the step', () => {
    const config = gear({
      sets: [
        { name: 'Default', when: 'always', mob: '', wear: ['golden ruby-eyed amulet'] },
        { name: 'Resting', when: 'resting', mob: '', wear: ['healing stone'] }
      ]
    });
    const manager = make(config, { slotOf: () => 'Neck' });
    const beforeRest = [worn('golden ruby-eyed amulet', 'Neck'), carried('healing stone')];
    manager.onCharacter(standing(beforeRest), false, 'resting');
    expect(sent).toEqual(['wear healing stone']);
    const afterRest = [worn('healing stone', 'Neck'), carried('golden ruby-eyed amulet')];
    manager.onCharacter(standing(afterRest), true, null);
    expect(sent).toEqual(['wear healing stone', 'wear golden ruby-eyed amulet']);
  });

  /*
   * Skinny, 2026-09-29: the rest set's ring and the base's shared a hand with a
   * ring no set names, each `wear` took the other set's ring off, and the kit
   * asked again every thirty seconds with `Changing into Rest Set.` on every
   * status line between.
   */
  it('swaps one ring for another on a full hand, and says so once', () => {
    const config = gear({
      sets: [
        { name: 'Normal Set', when: 'always', mob: '', wear: ['ring of faith'] },
        { name: 'Rest Set', when: 'resting', mob: '', wear: ['etched platinum ring'] }
      ]
    });
    const manager = make(config, { slotOf: () => 'Finger' });
    const walking = [
      worn('ring of faith', 'Finger'),
      worn('platinum moonstone ring', 'Finger'),
      carried('etched platinum ring')
    ];
    manager.onCharacter(standing(walking), false, 'resting');
    manager.onCharacter(standing(walking), false, 'resting');
    expect(sent).toEqual(['remove ring of faith', 'wear etched platinum ring']);
    expect(notices.filter((line) => line.includes('Rest Set'))).toHaveLength(1);

    const sitting = [
      worn('etched platinum ring', 'Finger'),
      worn('platinum moonstone ring', 'Finger'),
      carried('ring of faith')
    ];
    manager.onCharacter(standing(sitting), true, null);
    expect(sent.slice(2)).toEqual(['remove etched platinum ring', 'wear ring of faith']);
  });

  /* What the walker's next step waits on — see `WalkerEvents.kitReady`. */
  it('is dressing from the swap until the kit is on, or the swap expires', () => {
    const manager = make();
    const bare = [carried('plate boots'), carried('lifestealer')];
    manager.onCharacter(standing(bare), false, null);
    expect(manager.dressing).toBe(true);
    manager.onCharacter(
      standing([worn('plate boots', 'Feet'), worn('lifestealer', WEAPON_HAND)]),
      false,
      null
    );
    expect(manager.dressing).toBe(false);

    const swallowed = make();
    swallowed.onCharacter(standing(bare), false, null);
    clock += 60_000;
    expect(swallowed.dressing).toBe(false);
    expect(make(gear({ enabled: false })).dressing).toBe(false);
  });

  /*
   * Skinny, 2026-10-04: the sitting kit's `wear`s were still unanswered when
   * he was led into a wererat knight's room, and the fight's kit — the pack
   * as it stood — read as on, so `dfur` went out ahead of the swap.
   */
  it('is dressing while a swap is unanswered, though the pack still shows the kit wanted', () => {
    const config = gear({
      sets: [
        { name: 'Fighting', when: 'always', mob: '', wear: ['firestone pendant'] },
        { name: 'Meditating', when: 'meditating', mob: '', wear: ['jeweled moonstone medallion'] }
      ]
    });
    const manager = make(config, { slotOf: () => 'Neck' });
    const pack = [worn('firestone pendant', 'Neck'), carried('jeweled moonstone medallion')];
    manager.onCharacter(standing(pack), false, 'meditating');
    expect(sent).toEqual(['wear jeweled moonstone medallion']);
    // Led into a fight before the answer: the fight's kit is what the pack shows.
    manager.onCharacter(standing(pack), false, null, true);
    expect(manager.dressing).toBe(true);
    // The answer lands, and the fight's kit goes back on before the fight.
    const swapped = [worn('jeweled moonstone medallion', 'Neck'), carried('firestone pendant')];
    manager.onCharacter(standing(swapped), false, null, true);
    expect(sent).toEqual(['wear jeweled moonstone medallion', 'wear firestone pendant']);
    expect(manager.dressing).toBe(true);
  });

  it('says what a set names and the pack does not hold, once', () => {
    const manager = make();
    const state = standing([carried('lifestealer')]);
    manager.onCharacter(state, false, null);
    manager.onCharacter(state, false, null);
    expect(notices.filter((line) => line.includes('plate boots'))).toHaveLength(1);
  });
});

describe('using an item between rounds', () => {
  const offRound = (over: Partial<GearConfig['offRound']> = {}): GearConfig =>
    gear({ offRound: { item: 'nexus spear', everyRounds: 1, ...over } });

  const pack = (): CarriedItem[] => [
    worn('golden chalice', OFF_HAND),
    worn('lifestealer', WEAPON_HAND),
    carried('nexus spear')
  ];

  it('sends the whole dance on the round beat', () => {
    make(offRound()).round(fighting('nasty sandworm', pack()));
    expect(sent).toEqual([
      'remove golden chalice',
      'wear nexus spear',
      'use nexus spear nasty sandworm',
      'wear lifestealer',
      'wear golden chalice'
    ]);
  });

  it('counts rounds rather than status lines', () => {
    const manager = make(offRound({ everyRounds: 3 }));
    const state = fighting('nasty sandworm', pack());
    manager.round(state);
    manager.round(state);
    expect(sent).toEqual([]);
    manager.round(state);
    expect(sent.at(2)).toBe('use nexus spear nasty sandworm');
  });

  it('sends nothing at 0 rounds, with no item, or with nothing to aim at', () => {
    make(offRound({ everyRounds: 0 })).round(fighting('nasty sandworm', pack()));
    make(offRound({ item: '' })).round(fighting('nasty sandworm', pack()));
    make(offRound()).round(fighting(null, pack()));
    expect(sent).toEqual([]);
  });

  /* The wall-clock floor: rounds arriving faster than the dance can be sent. */
  it('will not queue a second dance behind the first', () => {
    const manager = make(offRound());
    const state = fighting('nasty sandworm', pack());
    manager.round(state);
    const first = sent.length;
    manager.round(state);
    expect(sent).toHaveLength(first);
  });
});
