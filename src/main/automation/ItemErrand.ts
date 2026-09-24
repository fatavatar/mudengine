/**
 * Going and getting the thing a route needs (todo 07, 2026-09-13).
 *
 * A route that crosses a keyed door already says what it needs — `Route.walls`
 * where this plan itself crosses it, `hazards[].needs` where a room's spell
 * wants something carried (`itemWanted` reads both). This closes the loop: the
 * realm knows where an item comes from (a shop that stocks it, a monster that
 * drops it), so the client goes and gets it and then walks the route that
 * wanted it.
 *
 * Two shapes and one ending. **Bought**: a session supply row with a floor of
 * one, through the errand that already knows how to walk to a counter, read a
 * `list` and confirm a `You just bought …`. **Found**: a loop over the rooms
 * the realm says its droppers live in, with the item's name added to what the
 * character picks up for as long as the errand runs, until the pack holds it.
 * Either way the owed route is walked afterwards and it is said which of the
 * two happened — because a key is worth keeping and a thing bought for one
 * door is not.
 *
 * Every refusal is said and traced (`SafetyDecision`, action `collect`). See
 * `mudengine-automation` § *A route that needs an item goes and gets it*.
 */
import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import type { SafetyDecision } from '../../shared/automation';
import type { CharacterState } from '../../shared/character';
import type { SupplyItem } from '../../shared/config';
import type { Loop } from '../../shared/loops';
import { carriedCount } from '../../shared/supplies';
import type { BuyingPlace, DropSources, RoomId, Route } from '../../shared/world';

/**
 * Where the realm says an item comes from: the counters, and the lairs with
 * the two facts a refusal needs beside them (`DropSources`).
 */
export interface ItemSources extends DropSources {
  /**
   * The counters that stock it, least out of the way first.
   *
   * **Rooms, not names.** A shop name is what the item index holds and what a
   * card prints; it is not somewhere to walk to, because one shop row stands in
   * several rooms — and handing a name to the shopping errand meant it asked
   * `shopPlace` to resolve it and was refused for the ambiguity (reported
   * 2026-09-16: *2 rooms hold a shop called Boat Launch*, said to a character
   * whose route walked through one of them).
   */
  shops: readonly BuyingPlace[];
  /**
   * Rooms where saying something gets it, nearest first — a handover (`ask
   * sleazy shopkeeper orb`) or a script that summons a dropper (`touch
   * statue`). See `WorldGraph.itemAsks`.
   */
  asks: ReadonlyArray<{ room: RoomId; roomName: string; say: string }>;
}

export interface ItemPlanner {
  here(): RoomId | null;
  /** Walk to one room. Null once walking — or already standing there. */
  walkTo(room: RoomId): string | null;
  /** Whether a walk is under way. */
  walking(): boolean;
  /** Send what is said to get the item, in the room it is said in. */
  say(command: string): void;
  /**
   * Ask the realm what the pack holds (`i`). A handover is said in the giver's
   * own words, which nothing reads, so the listing is how the errand learns
   * the thing arrived.
   */
  checkPack(): void;
  /**
   * Where the realm says this item comes from, from where the character stands
   * on the way to `to` — the counters by what stopping at each would add to
   * that journey, the lairs nearest first.
   */
  sourcesOf(item: { id: number; name: string }, to: RoomId | null): ItemSources;
  /**
   * Hand a one-off supply row to the shopping errand. Returns its refusal, or
   * null once it is walking. The row is never written to the player's file.
   */
  buy(row: SupplyItem): string | null;
  /** Whether the shopping errand is still on this row. */
  buying(): boolean;
  /** Run a loop filed nowhere, as the hunt does. */
  runLoop(loop: Loop): string | null;
  looping(): boolean;
  stopLoop(reason: string): void;
  /** Take this by name while the errand runs — session-scoped, never the file. */
  alsoTake(name: string): void;
  stopTaking(name: string): void;
  /** The route the player asked for, walked — or run (todo 06) — once the pack holds the item. */
  walk(route: Route, run: boolean): string | null;
  /** Whether the player's own supply list names this item, so it is kept. */
  kept(name: string): boolean;
}

export interface ItemEvents {
  notice?(message: string): void;
  decided?(decision: SafetyDecision): void;
}

interface Wanted {
  id: number;
  name: string;
}

/**
 * `rest` is what the way still wants after the item in hand: a way can ask
 * for several things (2026-09-23 — three for the long way to the Dark-Elf
 * Castle), and walking it with the first alone stops at the second.
 *
 * `owes` is the route walked once the pack holds the thing — or null for a
 * quest run's fetch (todo 103), which wants the item and nothing walked
 * afterwards: the run plans its own next leg from wherever the errand ends.
 * `run` is *Run it* (todo 06), carried to the walk the errand ends in.
 */
type Phase =
  | { kind: 'idle' }
  /**
   * At the counter, then — `checkedAt` set — waiting on the pack listing that
   * says whether the purchase is really carried.
   */
  | {
      kind: 'buying';
      item: Wanted;
      rest: Wanted[];
      owes: Route | null;
      run: boolean;
      checkedAt: number | null;
    }
  | { kind: 'hunting'; item: Wanted; rest: Wanted[]; owes: Route | null; run: boolean }
  /**
   * Going to say something for it: walking to `place`, then — `saidAt` set —
   * waiting for the pack to hold it, asking for the pack at `checkedAt`.
   */
  | {
      kind: 'asking';
      item: Wanted;
      rest: Wanted[];
      owes: Route | null;
      run: boolean;
      place: { room: RoomId; roomName: string; say: string };
      saidAt: number | null;
      checkedAt: number | null;
    }
  /**
   * The pack holds it and the way is still being offered to the walker.
   *
   * Its own phase because the handover is not instant: collecting is a loop,
   * and a loop steps on without waiting for the server to confirm what it
   * picked up, so at the moment the pack holds the thing there is a move of
   * this client's own still on the wire and `Walker.start` refuses to plan
   * across it. `why` is the last refusal, said only if the window runs out.
   */
  | { kind: 'delivering'; item: Wanted; owes: Route; run: boolean; until: number; why: string };

const ACTION = 'collect';

export class ItemErrand {
  private phase: Phase = { kind: 'idle' };

  constructor(
    private readonly planner: ItemPlanner,
    private readonly events: ItemEvents = {},
    private readonly now: () => number = () => Date.now()
  ) {}

  reset(): void {
    this.give();
    this.phase = { kind: 'idle' };
  }

  /** Whether an errand of this kind is running. */
  get running(): boolean {
    return this.phase.kind !== 'idle';
  }

  /**
   * Go and get every one of `items`, one after another, then walk `owes`.
   *
   * Returns a refusal for the window that asked — this is a press, so the
   * person is looking at the answer — and null once something is under way.
   * **The pack is asked first**: what the character is already carrying is
   * not fetched again, and a way whose every item is in the pack is walked
   * now — the commonest case for a key collected on an earlier trip. `run` is
   * *Run it*, carried to the walk the errand ends in.
   */
  collect(
    items: readonly Wanted[],
    owes: Route | null,
    state: CharacterState,
    run = false
  ): string | null {
    if (this.phase.kind !== 'idle') return t('automation.collect.refusalBusy');
    if (state.phase !== 'in-game') return t('automation.collect.refusalNotInRealm');
    const missing = items.filter((item) => carriedCount(state, item.name) === 0);
    const first = missing[0];
    if (first === undefined) {
      if (owes === null) return null;
      const refused = this.planner.walk(owes, run);
      return refused ?? null;
    }
    // Said once, up front, where there is more than one: the errand is then a
    // list, and a player watching it fetch the first thing should know it is
    // not the last.
    if (missing.length > 1) {
      this.events.notice?.(
        t('automation.collect.several', { items: missing.map((item) => item.name).join(', ') })
      );
    }
    return this.fetch(first, missing.slice(1), owes, run);
  }

  /** Start on one item, with `rest` still to come after it. */
  private fetch(item: Wanted, rest: Wanted[], owes: Route | null, run: boolean): string | null {
    // Where the errand is taking this character afterwards, so the counter is
    // chosen by how far off *that* road it is rather than by how near it is to
    // where the character happens to be standing.
    const sources = this.planner.sourcesOf(item, owes?.steps.at(-1)?.to ?? null);
    /*
     * **Bought before found**, where both are known: a counter is a fixed
     * price and a walk, and a drop is a fight and a chance. The player's own
     * supply list is what makes a found item worth keeping afterwards, which
     * is the other half of this decision.
     */
    const counter = sources.shops[0];
    if (counter !== undefined) {
      /*
       * **Addressed by room, never by name.** `at` is the field the item
       * panel's own shop picker writes and the one `shopRoom` resolves without
       * asking anything further; a `shop` with no `at` sends the errand back
       * through `shopPlace`, which refuses a name standing in several rooms —
       * correctly, for a name a *person* typed, and uselessly here, where the
       * room is the thing that was just chosen. The name rides along for the
       * sentence the errand says.
       */
      const row: SupplyItem = {
        name: item.name,
        min: 1,
        max: 1,
        shop: counter.shop,
        at: { map: counter.map, room: counter.room }
      };
      const refused = this.planner.buy(row);
      if (refused !== null) return this.refuse(item, refused);
      this.phase = { kind: 'buying', item, rest, owes, run, checkedAt: null };
      /*
       * Two literal calls rather than one sentence with a figure that is
       * sometimes zero: *0 steps off the way* is a number where the reader
       * wants a fact, and a counter the route already walks through is the
       * whole point of choosing by the detour.
       */
      this.events.notice?.(
        counter.detour === 0
          ? t('automation.collect.buyingOnTheWay', {
              item: item.name,
              shop: counter.shop,
              room: counter.roomName
            })
          : t('automation.collect.buying', {
              item: item.name,
              shop: counter.shop,
              room: counter.roomName,
              detour: counter.detour
            })
      );
      return null;
    }
    /*
     * **Asked before hunted**: a handover or a summoning script is a fixed
     * place and one phrase, and a lair is a lap of fights on a chance. A
     * summons is still a fight — the statue has to die for the gate key — but
     * one fight in one known room.
     */
    const ask = sources.asks[0];
    if (ask !== undefined) {
      const refused = this.planner.walkTo(ask.room);
      if (refused !== null) return this.refuse(item, refused);
      this.planner.alsoTake(item.name);
      this.phase = {
        kind: 'asking',
        item,
        rest,
        owes,
        run,
        place: ask,
        saidAt: null,
        checkedAt: null
      };
      this.events.notice?.(
        t('automation.collect.asking', { item: item.name, say: ask.say, room: ask.roomName })
      );
      return null;
    }
    const lair = sources.lairs[0];
    if (lair === undefined) {
      /*
       * Which of three it is, since each sends the player somewhere different
       * (`mudengine-automation` › *A route that needs an item goes and gets
       * it*). A sentence about placement names only the droppers the realm
       * places; *nowhere* is never said of a monster it does.
       */
      if (sources.droppers.length === 0) {
        return this.refuse(item, t('automation.collect.refusalNoSource'));
      }
      const placed = sources.droppers.filter((dropper) => dropper.placed > 0);
      const mobs = (placed.length > 0 ? placed : sources.droppers)
        .map((dropper) => dropper.mob)
        .join(', ');
      return this.refuse(
        item,
        placed.length > 0
          ? t('automation.collect.refusalDropperUnreachable', { mobs })
          : t('automation.collect.refusalDropperUnplaced', { mobs })
      );
    }
    /*
     * The loop is built from the realm's own rooms for those monsters, as the
     * Hunting card builds one, and filed nowhere. Its stops are every room
     * within reach that holds a dropper, nearest first.
     */
    const stops = sources.lairs.map((room) => ({ room: `${room.name} ${room.id}` }));
    const loop: Loop = { name: t('automation.collect.loopName', { item: item.name }), stops };
    // Picked up while the errand runs, and only while it runs.
    this.planner.alsoTake(item.name);
    const refused = this.planner.runLoop(loop);
    if (refused !== null) {
      this.planner.stopTaking(item.name);
      return this.refuse(item, refused);
    }
    this.phase = { kind: 'hunting', item, rest, owes, run };
    // Three literal calls, as `buying` above: *0 steps away* is a number
    // where the reader wants a fact, and *1 steps* is not English.
    const where = { item: item.name, mob: lair.mob, room: lair.name };
    this.events.notice?.(
      lair.steps === 0
        ? t('automation.collect.huntingHere', where)
        : lair.steps === 1
          ? t('automation.collect.huntingNextDoor', where)
          : t('automation.collect.hunting', { ...where, steps: lair.steps })
    );
    return null;
  }

  /**
   * The player took the character somewhere else, or died: the errand is off.
   *
   * Said out loud, because an errand that stopped silently is a route the
   * player thinks is still owed.
   */
  abandon(reason: string): void {
    if (this.phase.kind === 'idle') return;
    const { item } = this.phase;
    this.give();
    this.phase = { kind: 'idle' };
    this.refuse(item, t('automation.collect.abandoned', { item: item.name, why: reason }));
  }

  /**
   * The session's clock. Waiting on a thing asked for can be quiet — nothing
   * on the wire, so no state — and the pack is asked for, and the wait given
   * up, by time.
   */
  tick(state: CharacterState): void {
    const waiting =
      (this.phase.kind === 'asking' && this.phase.saidAt !== null) ||
      (this.phase.kind === 'buying' && this.phase.checkedAt !== null);
    if (waiting) this.onCharacter(state);
  }

  /** Every state change: has the pack got it yet? */
  onCharacter(state: CharacterState): void {
    if (this.phase.kind === 'idle') return;
    if (state.phase !== 'in-game') {
      this.abandon(t('automation.collect.whyLeftRealm'));
      return;
    }
    const { item, owes, run } = this.phase;
    /*
     * Still trying to hand the way over: try again from where the character
     * now stands. Every attempt re-plans, so this costs nothing until one
     * takes — and the refusal it is waiting out (a move of this client's own
     * still unanswered) clears the moment the room for it arrives.
     */
    if (this.phase.kind === 'delivering') {
      const refused = this.planner.walk(this.phase.owes, run);
      if (refused === null) {
        this.phase = { kind: 'idle' };
        return;
      }
      if (this.now() >= this.phase.until) {
        this.phase = { kind: 'idle' };
        this.events.notice?.(t('automation.collect.refusalRouteRefused', { why: refused }));
        return;
      }
      this.phase = { ...this.phase, why: refused };
      return;
    }
    if (this.phase.kind === 'buying') {
      this.onBuying(this.phase, state);
      return;
    }
    if (carriedCount(state, item.name) > 0) {
      this.deliver(item, owes, run, state);
      return;
    }
    if (this.phase.kind === 'asking') {
      this.onAsking(this.phase);
      return;
    }
    // And the lap stopping means the fights are over one way or another.
    if (this.phase.kind === 'hunting' && !this.planner.looping()) {
      this.give();
      this.phase = { kind: 'idle' };
      this.refuse(item, t('automation.collect.refusalLapStopped', { item: item.name }));
    }
  }

  /**
   * The pack holds it: stop collecting, say which happened, and go on to the
   * next thing the way wants — or, with nothing left, walk on (or run on).
   */
  private deliver(item: Wanted, owes: Route | null, run: boolean, state: CharacterState): void {
    const hunting = this.phase.kind === 'hunting';
    const rest =
      this.phase.kind === 'idle' || this.phase.kind === 'delivering' ? [] : this.phase.rest;
    this.give();
    this.phase = { kind: 'idle' };
    if (hunting) this.planner.stopLoop(t('automation.collect.stoppedGotIt', { item: item.name }));
    /*
     * **Which happened is worth saying.** A key the player's own supply list
     * names is kept — `supplies.items` lists `black star key` as *found* — and
     * a thing bought for one door is not, so the two sentences differ and each
     * says what the pack is now carrying around.
     */
    this.events.notice?.(
      this.planner.kept(item.name)
        ? t('automation.collect.gotAndKept', { item: item.name })
        : t('automation.collect.gotForTheDoor', { item: item.name })
    );
    this.events.decided?.({
      at: this.now(),
      action: ACTION,
      because: t('automation.collect.becauseDoor', { item: item.name }),
      acted: true
    });
    // Whatever the way still wants and the pack still lacks — something the
    // last errand picked up along the way is not fetched twice.
    const still = rest.filter((next) => carriedCount(state, next.name) === 0);
    const next = still[0];
    if (next !== undefined) {
      this.fetch(next, still.slice(1), owes, run);
      return;
    }
    // Nothing owed: a quest run's fetch, which plans its own next leg.
    if (owes === null) return;
    /*
     * **Offered, not fired once.** The loop that just found this has a step on
     * the wire — it stepped on before the server confirmed the pick-up — so
     * the walker refuses to plan across the unanswered move, and a single
     * attempt meant the thing was collected and the way it was collected for
     * was never walked (the reported failure, 2026-09-14). Held instead and
     * tried again on every state until it takes, or until the window is up and
     * the refusal is a real one worth saying.
     */
    const refused = this.planner.walk(owes, run);
    if (refused === null) return;
    this.phase = {
      kind: 'delivering',
      item,
      owes,
      run,
      until: this.now() + tuning().walk.errandHandoverMs,
      why: refused
    };
  }

  /**
   * The counter is done with: ask the pack, and go on by what it lists.
   *
   * **The listing decides, not the purchase line.** The line is read where it
   * can be, but a realm words it as it likes — `for 6 Krabby Patties, 44
   * platinum pieces, 80 gold crowns.` matched nothing, so the amber talisman
   * bought for the way to the Dark-Elf Castle never read as carried and the
   * way was never walked (reported 2026-09-23). A shopping errand that gave
   * up — unsold, too dear, no route — is asked about the same way: it has
   * said why in its own words, and the pack is what says whether it matters.
   */
  private onBuying(phase: Extract<Phase, { kind: 'buying' }>, state: CharacterState): void {
    const { item, owes, run } = phase;
    if (this.planner.buying()) return;
    if (phase.checkedAt === null) {
      this.planner.checkPack();
      this.phase = { ...phase, checkedAt: this.now() };
      return;
    }
    const listed = state.inventory.listedAt !== null && state.inventory.listedAt > phase.checkedAt;
    // No listing yet: wait for one, up to a check's spacing, then go on what
    // the pack is believed to hold.
    if (!listed && this.now() - phase.checkedAt < tuning().walk.errandPackCheckMs) return;
    if (carriedCount(state, item.name) > 0) {
      this.deliver(item, owes, run, state);
      return;
    }
    this.phase = { kind: 'idle' };
    this.refuse(item, t('automation.collect.refusalNotBought', { item: item.name }));
  }

  /**
   * Saying it once the character stands where it is said, and giving up when
   * it cannot be said or nothing comes of it. The pack holding the item is
   * read before this, by `onCharacter`, as for every other errand.
   */
  private onAsking(phase: Extract<Phase, { kind: 'asking' }>): void {
    const { item, place } = phase;
    if (phase.saidAt === null) {
      if (this.planner.walking()) return;
      if (this.planner.here() !== place.room) {
        this.give();
        this.phase = { kind: 'idle' };
        this.refuse(item, t('automation.collect.refusalNotReached', { room: place.roomName }));
        return;
      }
      /*
       * **Said, then the pack asked for.** A handover is announced in the
       * giver's words — the gnome commander's orb never read as carried, and
       * the errand stood there until it gave up (reported 2026-09-23). The
       * realm answers in order, so the listing comes after whatever the
       * phrase got.
       */
      this.planner.say(place.say);
      this.planner.checkPack();
      this.phase = { ...phase, saidAt: this.now(), checkedAt: this.now() };
      return;
    }
    // And again while it waits: a summons is a fight before it is an item.
    const checkedAt = phase.checkedAt ?? phase.saidAt;
    if (this.now() - checkedAt >= tuning().walk.errandPackCheckMs) {
      this.planner.checkPack();
      this.phase = { ...phase, checkedAt: this.now() };
    }
    if (this.now() - phase.saidAt < tuning().walk.errandAskMs) return;
    this.give();
    this.phase = { kind: 'idle' };
    this.refuse(
      item,
      t('automation.collect.refusalAskedNothing', { item: item.name, say: place.say })
    );
  }

  /** Stop taking what was only ever wanted for this errand. */
  private give(): void {
    if (this.phase.kind === 'idle') return;
    this.planner.stopTaking(this.phase.item.name);
  }

  private refuse(item: Wanted, why: string): string {
    this.events.notice?.(why);
    this.events.decided?.({
      at: this.now(),
      action: ACTION,
      because: t('automation.collect.becauseDoor', { item: item.name }),
      acted: false,
      refused: why
    });
    return why;
  }
}
