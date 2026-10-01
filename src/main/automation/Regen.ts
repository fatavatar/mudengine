/**
 * The spells that speed a recovery, and the ones a full one earns — MegaMUD's
 * *HP Regen*, *Mana Regen*, *Min Flux Rate*, *When HP Full* and *When Mana
 * Full*, timed as `megamud.exe` times them (read 2026-09-29; the addresses are
 * in `docs/megamud/megamud-exe.md`, *Health*):
 *
 * - **HP regen** goes out ahead of a rest (0x41518a): health short of its
 *   maximum, nothing saying it is already regenerating, and the mana a heal
 *   is cast at. The rest waits for the next line — see `beforeRest`.
 * - **Mana regen** goes out whenever mana is 20 short of its maximum out of
 *   meditation, with nothing saying it is already up (0x414d6e), and again
 *   while it is up when a tick comes in under `manaMinTick` (0x494c90).
 * - **When full** goes out once each time health reaches `restTo` or mana
 *   reaches `meditateTo`, and is armed again when it drops below (0x4146aa).
 *
 * "Already regenerating" is the realm's own word where it has one — a message
 * row marked `hp-regen` or `mana-regen`, or the spell itself on the buff list
 * — or this module's cast. The cast is forgotten when either ends, or once
 * health and mana are both full (the exe's thirty-second tick, 0x40a9c0), so a
 * spell nothing says has ended is cast again only after a full recovery.
 *
 * The buff list because a realm's table may carry no row for the spell, and
 * then only a full recovery forgot the cast — which a caster, whose mana is
 * rarely full when its health is, hardly ever has. Measured 2026-10-01:
 * skinny's `divine restoration` (no row on skinny-inc) ended a minute after
 * each cast, and 73 rests that evening sat down below `restBelow` with it
 * ended, the mana to cast it, and no `rsto` before them.
 */
import { OPEN_GATE, type CastGate } from './castRound';
import type { CommandQueue } from './CommandQueue';
import { canPayFor, manaAtLeast } from './mana';
import { fightIsHere } from './Recovery';
import { t } from '../app/i18n';
import { tuning } from '../app/tuning';
import { isStated, type CharacterState } from '../../shared/character';
import type { HealthConfig, SpellsConfig } from '../../shared/config';
import { resolveSpell, sameSpell, spellCost } from '../../shared/spellcraft';
import type { WorldSpell } from '../../shared/world';

type Cast = 'hp' | 'mana' | 'hpFull' | 'manaFull';

export class Regen {
  /** This module's own casts, held until the realm or a full recovery says they are over. */
  private hpUp = false;
  private manaUp = false;
  /** Whether the realm's row was holding each, on the last line — its end is the edge. */
  private heardHp = false;
  private heardMana = false;
  /** When-full casts spent since the figure last dropped below its line. */
  private hpFullSpent = false;
  private manaFullSpent = false;
  /** The tick monitor: the last reading, when the last tick came, and its size. */
  private lastMana: number | null = null;
  private tickAt: number | null = null;
  private tick: number | null = null;
  /** A tick under `manaMinTick` while mana regen is up: cast it again. */
  private recast = false;
  private gate: CastGate = OPEN_GATE;

  constructor(
    private config: SpellsConfig,
    private health: HealthConfig,
    private enabled: boolean,
    private readonly queue: CommandQueue,
    private readonly realmSpell: (name: string) => WorldSpell | null = () => null,
    private readonly now: () => number = () => Date.now()
  ) {}

  configure(config: SpellsConfig, health: HealthConfig, enabled: boolean): void {
    this.config = config;
    this.health = health;
    this.enabled = enabled;
  }

  useCastGate(gate: CastGate): void {
    this.gate = gate;
  }

  /** A new connection: nothing is up and nothing has been measured. */
  reset(): void {
    this.hpUp = this.manaUp = this.heardHp = this.heardMana = false;
    this.hpFullSpent = this.manaFullSpent = false;
    this.lastMana = this.tickAt = this.tick = null;
    this.recast = false;
  }

  /**
   * Every line: what is up, what a tick brought, and — out of a fight — the
   * when-full spells and mana regen, in the exe's order. Returns whether it
   * cast, in which case nothing else sits the character down on this line.
   */
  onCharacter(state: CharacterState): boolean {
    this.observe(state);
    if (!this.enabled || state.phase !== 'in-game' || fightIsHere(state)) return false;
    const { hp, hpMax, mana, manaMax, meditating } = state.vitals;

    if (manaMax !== null && manaMax > 0 && mana !== null) {
      const full = mana / manaMax >= line(this.health.meditateTo);
      if (!full) this.manaFullSpent = false;
      else if (!this.manaFullSpent && this.cast(state, 'manaFull', this.config.regen.manaFull)) {
        this.manaFullSpent = true;
        return true;
      }
    }
    if (hpMax !== null && hpMax > 0 && hp !== null) {
      const full = hp / hpMax >= line(this.health.restTo);
      if (!full) this.hpFullSpent = false;
      else if (!this.hpFullSpent && this.cast(state, 'hpFull', this.config.regen.hpFull)) {
        this.hpFullSpent = true;
        return true;
      }
    }

    // Mana regen: 20 short out of meditation, or a slow tick while it is up.
    if (manaMax === null || manaMax <= 0 || mana === null || this.tick === null) return false;
    const short = manaMax - mana > tuning().spells.manaRegenShortfall;
    const wanted = this.recast || (short && !meditating && !this.manaRegenerating(state));
    if (!wanted || !this.cast(state, 'mana', this.config.regen.mana)) return false;
    this.manaUp = true;
    this.recast = false;
    return true;
  }

  /**
   * Asked by `Recovery` before it sits the character down to rest: HP regen
   * first, where it is wanted. True means it went out and the rest waits for
   * the next line, as the exe's own pass ends on the cast.
   */
  beforeRest(state: CharacterState): boolean {
    if (!this.enabled || state.phase !== 'in-game') return false;
    const { hp, hpMax } = state.vitals;
    if (hp === null || hpMax === null || hp >= hpMax) return false;
    if (this.hpRegenerating(state) || !manaAtLeast(state, this.config.minMana)) return false;
    if (!this.cast(state, 'hp', this.config.regen.hp)) return false;
    this.hpUp = true;
    return true;
  }

  private hpRegenerating(state: CharacterState): boolean {
    return this.hpUp || this.heardHpNow(state);
  }

  private manaRegenerating(state: CharacterState): boolean {
    return this.manaUp || this.heardManaNow(state);
  }

  /** The realm saying HP regen is up: its message row, or the spell on the buff list. */
  private heardHpNow(state: CharacterState): boolean {
    return isStated(state, 'hp-regen') || this.buffUp(state, this.config.regen.hp);
  }

  private heardManaNow(state: CharacterState): boolean {
    return isStated(state, 'mana-regen') || this.buffUp(state, this.config.regen.mana);
  }

  /** Whether `spell` is on the buff list, under any name its sentence could mean. */
  private buffUp(state: CharacterState, spell: string): boolean {
    if (spell.length === 0) return false;
    return state.buffs.some((buff) =>
      [buff.spell, ...(buff.candidates ?? [])].some((name) =>
        sameSpell(name, spell, state.spellbook, this.realmSpell)
      )
    );
  }

  /**
   * What is up, and the tick monitor. A drop in mana is spending — the exe
   * skips the reading after a cast of its own (`d838`) — so it only moves the
   * baseline; a gain is a tick, and so is no gain for `manaTickWaitMs`.
   */
  private observe(state: CharacterState): void {
    const heardHp = this.heardHpNow(state);
    const heardMana = this.heardManaNow(state);
    if (this.heardHp && !heardHp) this.hpUp = false;
    if (this.heardMana && !heardMana) this.manaUp = false;
    this.heardHp = heardHp;
    this.heardMana = heardMana;

    const { hp, hpMax, mana, manaMax, meditating } = state.vitals;
    if (
      hp !== null &&
      hpMax !== null &&
      hp >= hpMax &&
      (manaMax === null || manaMax <= 0 || (mana !== null && mana >= manaMax))
    ) {
      this.hpUp = this.manaUp = false;
    }

    if (mana === null || manaMax === null || manaMax <= 0) return;
    const at = this.now();
    const last = this.lastMana;
    this.lastMana = mana;
    if (meditating || mana >= manaMax || hp === null || hp < 1 || last === null) {
      this.tickAt = at;
      return;
    }
    const gained = mana - last;
    if (gained < 0) return;
    if (gained === 0 && at - (this.tickAt ?? at) <= tuning().spells.manaTickWaitMs) return;
    this.tickAt = at;
    this.tick = gained;
    const floor = this.config.regen.manaMinTick;
    this.recast = this.manaRegenerating(state) && floor > 0 && gained < floor;
  }

  private cast(state: CharacterState, which: Cast, spell: string): boolean {
    if (spell.length === 0 || !this.gate.mayCast()) return false;
    const found = resolveSpell(spell, state.spellbook, this.realmSpell);
    if (!canPayFor(state, spellCost(found))) return false;
    return this.queue.enqueue({
      command: found.word,
      priority: 'probe',
      coalesceKey: `regen:${which}`,
      expiresAt: this.now() + tuning().rest.expiresMs,
      onSent: () => this.gate.noteCast(),
      reason: reasonFor(which, found.word)
    });
  }
}

/** A `…To` setting as the exe's *Full%*: unset is the whole bar. */
function line(to: number): number {
  return to > 0 ? to : 1;
}

function reasonFor(which: Cast, spell: string): string {
  switch (which) {
    case 'hp':
      return t('automation.regen.reasonHp', { spell });
    case 'mana':
      return t('automation.regen.reasonMana', { spell });
    case 'hpFull':
      return t('automation.regen.reasonHpFull', { spell });
    case 'manaFull':
      return t('automation.regen.reasonManaFull', { spell });
  }
}
