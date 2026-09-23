import { beforeEach, describe, expect, it } from 'vitest';

import { ItemErrand, type ItemPlanner, type ItemSources } from '../ItemErrand';
import { tuning } from '../../app/tuning';
import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import type { SafetyDecision } from '../../../shared/automation';
import type { SupplyItem } from '../../../shared/config';
import type { Loop } from '../../../shared/loops';
import type { BuyingPlace, Route } from '../../../shared/world';

const KEY = { id: 4211, name: 'black star key' };

const OWED: Route = {
  steps: [{ from: '1/1', to: '1/2' }] as unknown as Route['steps'],
  cost: 1,
  blocked: false
} as Route;

/** In the realm, carrying nothing. */
function ready(over: Partial<CharacterState> = {}): CharacterState {
  const base = structuredClone(EMPTY_CHARACTER);
  return { ...base, phase: 'in-game', ...over };
}

/** In the realm with the key — and whatever else is named — in the pack. */
function carrying(...names: string[]): CharacterState {
  const base = ready();
  const held = names.length === 0 ? ['black star key'] : names;
  return {
    ...base,
    inventory: {
      ...base.inventory,
      items: held.map((name) => ({ name }))
    } as CharacterState['inventory']
  };
}

const ROPE = { id: 191, name: 'rope and grapple' };
const TALISMAN = { id: 570, name: 'amber talisman' };

let notices: string[];
let decisions: SafetyDecision[];
let sources: ItemSources;
let bought: SupplyItem[];
let loops: Loop[];
let walked: Route[];
let taking: string[];
let buying: boolean;
let looping: boolean;
let keptNames: string[];
let walkedTo: string[];
let said: string[];
let packChecks: number;
let walking: boolean;
let here: string;

function errand(over: Partial<ItemPlanner> = {}, now?: () => number): ItemErrand {
  const planner: ItemPlanner = {
    here: () => here,
    walkTo: (room) => {
      walkedTo.push(room);
      walking = true;
      return null;
    },
    walking: () => walking,
    say: (command) => said.push(command),
    checkPack: () => {
      packChecks += 1;
    },
    sourcesOf: () => sources,
    buy: (row) => {
      bought.push(row);
      buying = true;
      return null;
    },
    buying: () => buying,
    runLoop: (loop) => {
      loops.push(loop);
      looping = true;
      return null;
    },
    looping: () => looping,
    stopLoop: () => {
      looping = false;
    },
    alsoTake: (name) => taking.push(name),
    stopTaking: (name) => {
      taking = taking.filter((entry) => entry !== name);
    },
    walk: (route) => {
      walked.push(route);
      return null;
    },
    kept: (name) => keptNames.includes(name),
    ...over
  };
  return new ItemErrand(
    planner,
    {
      notice: (message) => notices.push(message),
      decided: (decision) => decisions.push(decision)
    },
    now
  );
}

beforeEach(() => {
  notices = [];
  decisions = [];
  bought = [];
  loops = [];
  walked = [];
  taking = [];
  buying = false;
  looping = false;
  keptNames = [];
  walkedTo = [];
  said = [];
  packChecks = 0;
  walking = false;
  here = '1/1';
  sources = { shops: [], lairs: [], asks: [] };
});

/**
 * One counter, as `WorldGraph.buyingPlaces` hands it over: a room, not a name.
 * `detour` is what stopping there adds to the journey, in plain steps.
 */
function counter(over: Partial<BuyingPlace> = {}): BuyingPlace {
  return {
    map: 1,
    room: 42,
    roomName: 'Locksmith Row',
    shop: 'Locksmith',
    markup: 100,
    detour: 6,
    moves: 12,
    ...over
  };
}

describe('collecting what a route needs', () => {
  /* The commonest case for a key: it was collected on an earlier trip. */
  it('walks straight off when the pack already holds it', () => {
    const auto = errand();
    expect(auto.collect([KEY], OWED, carrying())).toBeNull();
    expect(walked).toEqual([OWED]);
    expect(bought).toHaveLength(0);
    expect(loops).toHaveLength(0);
  });

  /*
   * Bought before found where both are known: a counter is a fixed price and a
   * walk, and a drop is a fight and a chance. The row is a session row with a
   * floor of one and is written nowhere.
   */
  it('buys it where the realm names a shop', () => {
    sources = { shops: [counter()], lairs: [], asks: [] };
    const auto = errand();
    expect(auto.collect([KEY], OWED, ready())).toBeNull();
    /*
     * **Addressed by room.** `at` is what `shopRoom` resolves without asking
     * anything further; a bare `shop` name sends it back through `shopPlace`,
     * which refuses a name standing in several rooms.
     */
    expect(bought).toEqual([
      { name: 'black star key', min: 1, max: 1, shop: 'Locksmith', at: { map: 1, room: 42 } }
    ]);
    expect(walked).toHaveLength(0);

    // The pack holds it: the route the player asked for is walked.
    auto.onCharacter(carrying());
    expect(walked).toEqual([OWED]);
    expect(decisions.at(-1)).toMatchObject({ action: 'collect', acted: true });
  });

  /*
   * Found: a loop over the rooms the realm says its droppers live in, with the
   * name added to what the character picks up for as long as the errand runs.
   */
  it('hunts for it where only a monster drops it', () => {
    sources = {
      shops: [],
      lairs: [
        { id: '1/816', name: 'Graveyard', mob: 'fierce zombie', steps: 4 },
        { id: '1/833', name: 'Crypt', mob: 'fierce zombie', steps: 6 }
      ],
      asks: []
    };
    const auto = errand();
    expect(auto.collect([KEY], OWED, ready())).toBeNull();
    expect(loops).toHaveLength(1);
    expect(loops[0]!.stops).toEqual([{ room: 'Graveyard 1/816' }, { room: 'Crypt 1/833' }]);
    // Picked up while the errand runs, and only while it runs.
    expect(taking).toEqual(['black star key']);

    auto.onCharacter(carrying());
    expect(taking).toEqual([]);
    expect(looping).toBe(false);
    expect(walked).toEqual([OWED]);
  });

  /*
   * A key the player's own list names is kept; a thing bought for one door is
   * not, and which happened is said.
   */
  it('says whether what it collected stays in the pack', () => {
    sources = { shops: [counter()], lairs: [], asks: [] };
    keptNames = ['black star key'];
    const auto = errand();
    auto.collect([KEY], OWED, ready());
    auto.onCharacter(carrying());
    expect(notices.some((line) => line.includes('stays'))).toBe(true);
  });

  it('refuses out loud where the realm names no source', () => {
    const auto = errand();
    const refused = auto.collect([KEY], OWED, ready());
    expect(refused).not.toBeNull();
    expect(walked).toHaveLength(0);
    expect(decisions.at(-1)).toMatchObject({ action: 'collect', acted: false });
  });

  /* The shopping errand gave up: the route is not walked, and it says so. */
  it('does not walk the route when the errand ends without the item', () => {
    sources = { shops: [counter()], lairs: [], asks: [] };
    const auto = errand();
    auto.collect([KEY], OWED, ready());
    buying = false;
    auto.onCharacter(ready());
    expect(walked).toHaveLength(0);
    expect(decisions.at(-1)).toMatchObject({ acted: false });
  });

  /*
   * The reported failure, from the wire
   * (`logs/2026-09-14_16-00-21_festus.mudcap.jsonl`): the lap's own next step
   * went out two milliseconds after the `get` and eighty before the server
   * confirmed it, so at the moment the pack held the key there was a move
   * outstanding and `Walker.start` refused to plan across it. One attempt
   * meant the key was collected and the way it was collected for never walked.
   */
  it('keeps offering the way while a move of its own is still unanswered', () => {
    sources = {
      shops: [],
      lairs: [{ id: '1/816', name: 'Graveyard', mob: 'zombie', steps: 4 }],
      asks: []
    };
    let inFlight = true;
    const auto = errand({
      walk: (route) => {
        if (inFlight) return 'a move has not been answered yet';
        walked.push(route);
        return null;
      }
    });
    auto.collect([KEY], OWED, ready());

    // The pack holds it, and the walker cannot plan across the step in flight.
    auto.onCharacter(carrying());
    expect(walked).toHaveLength(0);
    // Said as collected all the same, because it was.
    expect(decisions.at(-1)).toMatchObject({ action: 'collect', acted: true });
    // And not reported as a failure, because it has not failed yet.
    expect(notices.some((line) => line.includes('did not start'))).toBe(false);

    // The room for that move lands: the way is planned again and walked.
    inFlight = false;
    auto.onCharacter(carrying());
    expect(walked).toEqual([OWED]);
  });

  /* And a refusal that never clears is said out loud once the window is up. */
  it('says why it gave up when the way goes on refusing', () => {
    sources = {
      shops: [],
      lairs: [{ id: '1/816', name: 'Graveyard', mob: 'zombie', steps: 4 }],
      asks: []
    };
    let clock = 0;
    const auto = errand({ walk: () => 'there is no way there' }, () => clock);
    auto.collect([KEY], OWED, ready());

    auto.onCharacter(carrying());
    expect(notices.some((line) => line.includes('there is no way there'))).toBe(false);

    // Past the window the refusal is a real one, and it is named.
    clock += tuning().walk.errandHandoverMs + 1;
    auto.onCharacter(carrying());
    expect(walked).toHaveLength(0);
    expect(notices.some((line) => line.includes('there is no way there'))).toBe(true);
  });

  /* And what it was taking is given back when the errand is abandoned. */
  it('stops taking the item when it gives up', () => {
    sources = {
      shops: [],
      lairs: [{ id: '1/816', name: 'Graveyard', mob: 'zombie', steps: 4 }],
      asks: []
    };
    const auto = errand();
    auto.collect([KEY], OWED, ready());
    expect(taking).toEqual(['black star key']);
    auto.abandon('the character died');
    expect(taking).toEqual([]);
    expect(walked).toHaveLength(0);
  });
});

/*
 * A way that wants several things (2026-09-23): Slum Street, Crossroads to the
 * Dark-Elf Castle gatehouse, round the long way, wanted three items the pack
 * lacked — and the errand fetched the first and walked, to be stopped at the
 * second. Every one is fetched, in turn, before the way is walked.
 */
describe('collecting everything a route needs', () => {
  it('fetches each missing item in turn, then walks', () => {
    sources = { shops: [counter()], lairs: [], asks: [] };
    const auto = errand();
    expect(auto.collect([KEY, ROPE, TALISMAN], OWED, ready())).toBeNull();
    expect(bought.map((row) => row.name)).toEqual(['black star key']);

    buying = false;
    auto.onCharacter(carrying('black star key'));
    expect(bought.map((row) => row.name)).toEqual(['black star key', 'rope and grapple']);
    expect(walked).toHaveLength(0);

    buying = false;
    auto.onCharacter(carrying('black star key', 'rope and grapple'));
    expect(bought.map((row) => row.name)).toEqual([
      'black star key',
      'rope and grapple',
      'amber talisman'
    ]);
    expect(walked).toHaveLength(0);

    auto.onCharacter(carrying('black star key', 'rope and grapple', 'amber talisman'));
    expect(walked).toEqual([OWED]);
  });

  it('skips what the pack already holds', () => {
    sources = { shops: [counter()], lairs: [], asks: [] };
    const auto = errand();
    auto.collect([KEY, ROPE], OWED, carrying('black star key'));
    expect(bought.map((row) => row.name)).toEqual(['rope and grapple']);
    auto.onCharacter(carrying('black star key', 'rope and grapple'));
    expect(walked).toEqual([OWED]);
  });

  it('names everything it is going for', () => {
    sources = { shops: [counter()], lairs: [], asks: [] };
    errand().collect([KEY, ROPE, TALISMAN], OWED, ready());
    const said = notices.join(' ');
    expect(said).toContain('rope and grapple');
    expect(said).toContain('amber talisman');
  });

  it('does not walk when a later item cannot be had', () => {
    let calls = 0;
    const auto = errand({
      sourcesOf: () =>
        calls++ === 0
          ? { shops: [counter()], lairs: [], asks: [] }
          : { shops: [], lairs: [], asks: [] }
    });
    auto.collect([KEY, ROPE], OWED, ready());
    buying = false;
    auto.onCharacter(carrying('black star key'));
    expect(walked).toHaveLength(0);
    expect(auto.running).toBe(false);
    expect(decisions.at(-1)).toMatchObject({ action: 'collect', acted: false });
  });
});

/*
 * An item had by saying something (2026-09-23): the gate key drops from an
 * obsidian statue that `touch statue` at the Black Steel Gate summons, and the
 * moldy key is handed over for `ask sleazy shopkeeper orb`. The errand walks
 * there, says it once it has arrived, and waits for the pack to hold it —
 * a summons is a fight first, which auto-combat is for.
 */
describe('collecting what is had by saying something', () => {
  const GATE_KEY = { id: 806, name: 'gate key' };
  const statue = { room: '8/461', roomName: 'Black Steel Gate', say: 'touch statue' };

  it('walks there, says it on arrival, and walks the way once it is held', () => {
    sources = { shops: [], lairs: [], asks: [statue] };
    const auto = errand();
    expect(auto.collect([GATE_KEY], OWED, ready())).toBeNull();
    expect(walkedTo).toEqual(['8/461']);
    // Picked up once whatever it summons is dead, and only for the errand.
    expect(taking).toEqual(['gate key']);
    expect(said).toEqual([]);

    // Still walking: nothing is said on the way.
    auto.onCharacter(ready());
    expect(said).toEqual([]);

    walking = false;
    here = '8/461';
    auto.onCharacter(ready());
    expect(said).toEqual(['touch statue']);
    auto.onCharacter(ready());
    expect(said).toEqual(['touch statue']);

    auto.onCharacter(carrying('gate key'));
    expect(walked).toEqual([OWED]);
    expect(taking).toEqual([]);
  });

  it('says it straight away where the character is already standing there', () => {
    sources = { shops: [], lairs: [], asks: [statue] };
    here = '8/461';
    const auto = errand({
      walkTo: (room) => {
        walkedTo.push(room);
        return null;
      }
    });
    auto.collect([GATE_KEY], OWED, ready());
    auto.onCharacter(ready());
    expect(said).toEqual(['touch statue']);
  });

  it('gives up out loud when nothing comes of it', () => {
    sources = { shops: [], lairs: [], asks: [statue] };
    let clock = 0;
    const auto = errand({}, () => clock);
    auto.collect([GATE_KEY], OWED, ready());
    walking = false;
    here = '8/461';
    auto.onCharacter(ready());
    clock += tuning().walk.errandAskMs + 1;
    auto.onCharacter(ready());
    expect(auto.running).toBe(false);
    expect(walked).toHaveLength(0);
    expect(taking).toEqual([]);
    expect(notices.some((line) => line.includes('touch statue'))).toBe(true);
  });

  it('gives up when the walk there ends somewhere else', () => {
    sources = { shops: [], lairs: [], asks: [statue] };
    const auto = errand();
    auto.collect([GATE_KEY], OWED, ready());
    walking = false;
    auto.onCharacter(ready());
    expect(said).toEqual([]);
    expect(auto.running).toBe(false);
    expect(decisions.at(-1)).toMatchObject({ action: 'collect', acted: false });
  });

  /*
   * The reported failure (2026-09-23): `ask gnome commander orb` got the orb,
   * but the handover is said in the commander's words, which nothing reads, so
   * the pack never showed it and the errand waited out its three minutes.
   */
  it('asks for the pack straight after saying it, so a handover is seen', () => {
    const ORB = { id: 811, name: 'bloodstone orb' };
    const gnome = { room: '8/459', roomName: 'Gnome Camp', say: 'ask gnome commander orb' };
    sources = { shops: [], lairs: [], asks: [gnome] };
    here = '8/459';
    const auto = errand();
    auto.collect([ORB], OWED, ready());
    walking = false;
    auto.onCharacter(ready());
    expect(said).toEqual(['ask gnome commander orb']);
    expect(packChecks).toBe(1);
    // The listing that answers it holds the orb.
    auto.onCharacter(carrying('bloodstone orb'));
    expect(walked).toEqual([OWED]);
  });

  it('asks for the pack again while it waits, on the clock alone', () => {
    sources = { shops: [], lairs: [], asks: [statue] };
    let clock = 0;
    const auto = errand({}, () => clock);
    auto.collect([GATE_KEY], OWED, ready());
    walking = false;
    here = '8/461';
    auto.onCharacter(ready());
    expect(packChecks).toBe(1);
    clock += tuning().walk.errandPackCheckMs - 1;
    auto.tick(ready());
    expect(packChecks).toBe(1);
    clock += 1;
    auto.tick(ready());
    expect(packChecks).toBe(2);
    auto.tick(ready());
    expect(packChecks).toBe(2);
    // And the wait is given up by the clock too, with nothing on the wire.
    clock += tuning().walk.errandAskMs;
    auto.tick(ready());
    expect(auto.running).toBe(false);
  });

  it('does not ask for the pack before anything is said', () => {
    sources = { shops: [], lairs: [], asks: [statue] };
    const auto = errand();
    auto.collect([GATE_KEY], OWED, ready());
    auto.tick(ready());
    auto.onCharacter(ready());
    expect(packChecks).toBe(0);
  });

  it('buys before it asks, and asks before it hunts', () => {
    sources = {
      shops: [],
      lairs: [{ id: '1/816', name: 'Graveyard', mob: 'obsidian statue', steps: 4 }],
      asks: [statue]
    };
    errand().collect([GATE_KEY], OWED, ready());
    expect(walkedTo).toEqual(['8/461']);
    expect(loops).toHaveLength(0);
  });
});
