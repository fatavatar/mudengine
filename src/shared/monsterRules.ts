/**
 * What a player has said about particular monsters — MegaMUD's *Monster
 * Details* (roadmap step 3, 2026-09-23).
 *
 * One row per monster, and every field optional: a row says only what differs
 * from how a monster nobody listed is treated. That is what makes the three
 * places a row can come from compose. A realm's table is imported once from
 * MegaMUD's `Monsters.md` (`servers/<id>/monsters.yaml`, `RealmMonsterStore`)
 * and every character playing there gets it; a character's own rows
 * (`automation.combat.monsters`) are laid over it **field by field**, so a
 * shaman can name an attack spell for a monster without restating that the
 * realm marks it Flee, and a warrior who never casts inherits the realm's row
 * unchanged.
 *
 * The fields, from the dialog and its help page (MegaMud.chm,
 * `idh_dlg_mstrinfo`, `idh_relationships`):
 *
 * - **relationship** — `friend` is never attacked, even when it swings first;
 *   `avoid` is never started on but is hit back; `enemy` is attacked on sight,
 *   which is also how an unlisted monster is treated; `escape` (MegaMUD's
 *   *Flee*) is run from, and
 *   everything else in the room with it is ignored; `hangup` ends the
 *   session the moment it is in the room.
 * - **priority** — MegaMUD's five attack bands, the same five
 *   `combat.mobPriority` states. A `mobPriority` row still wins, because it
 *   is the more specific statement.
 * - **notHostile** — it will not attack unprovoked, so resting in its room is
 *   allowed.
 * - **noBackstab** — the opener is not a backstab on this one.
 * - **stopToKill** — a lap or a walk stops to kill it even below `minMobs`.
 * - **preAttack / attack** — a spell cast before the fight is opened (it
 *   opens nothing itself), and the spell to fight it with instead of
 *   `spells.attack`, which opens the fight as `a` would; `max` 0 means the
 *   combat setting's own count.
 *
 * MegaMUD's *Find first* is not carried: it orders substring matching so
 * `dark bishop` is found before `bishop`, and `ruleFor` always tries the
 * longest name first. *Check if alive* belongs to a MudOp tool this client
 * does not have.
 */
// Types only: `config.ts` reads rows through `asMonsterRules`, so a value
// import back would be a cycle for a bundler to order.
import type { MobPriorityBand } from './config';
import type { UiLookup } from './i18n';
import { mobNameCandidates } from './mobs';
import { isRecord } from './values';
import { mobKey } from './world';

/*
 * `escape` is MegaMUD's *Flee*, under this client's own word for running out of
 * a room: `flee` is on `NOT_COMMANDS` and kept out of every string here, so no
 * path can ever carry it to the wire. The label still reads *Flee*.
 */
export const RELATIONSHIPS = ['friend', 'avoid', 'enemy', 'escape', 'hangup'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** A spell for one monster, by the name or short word the player would type. */
export interface MonsterSpell {
  spell: string;
  /** Casts per fight; 0 leaves it to the combat setting. */
  max: number;
}

export interface MonsterRule {
  /** The monster, keyed the way `mobKey` keys a name. */
  mob: string;
  relationship?: Relationship;
  priority?: MobPriorityBand;
  notHostile?: boolean;
  noBackstab?: boolean;
  stopToKill?: boolean;
  preAttack?: MonsterSpell;
  attack?: MonsterSpell;
}

export interface MonsterTableSource {
  file: string;
  importedAt: string;
}

/** A realm's imported table, as `servers/<id>/monsters.yaml` holds it. */
export interface MonsterTable {
  source: MonsterTableSource | null;
  monsters: MonsterRule[];
}

export const EMPTY_MONSTER_TABLE: MonsterTable = { source: null, monsters: [] };

/** What an import read, or why it wrote nothing. */
export type MonsterImport =
  | {
      ok: true;
      /** Rows now in the realm's table. */
      count: number;
    }
  | { ok: false; error: string };

/* ------------------------------------------------------------ reading */

function isRelationship(value: unknown): value is Relationship {
  return typeof value === 'string' && (RELATIONSHIPS as readonly string[]).includes(value);
}

/** `MOB_PRIORITIES`, restated for the reason the import above is types only. */
const BANDS: readonly MobPriorityBand[] = ['first', 'high', 'default', 'low', 'last'];

function isBand(value: unknown): value is MobPriorityBand {
  return typeof value === 'string' && (BANDS as readonly string[]).includes(value);
}

function asSpell(value: unknown): MonsterSpell | undefined {
  if (typeof value === 'string') {
    const spell = value.trim();
    return spell.length > 0 ? { spell, max: 0 } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const spell = typeof value['spell'] === 'string' ? value['spell'].trim() : '';
  if (spell.length === 0) return undefined;
  const max = value['max'];
  return {
    spell,
    max: typeof max === 'number' && Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  };
}

/**
 * One row from whatever the file or the wire held, or null for one with no
 * monster. Forgiving per field: an unknown relationship is dropped, not the row.
 */
export function asMonsterRule(value: unknown): MonsterRule | null {
  if (!isRecord(value)) return null;
  const mob = typeof value['mob'] === 'string' ? mobKey(value['mob']) : '';
  if (mob.length === 0) return null;
  const rule: MonsterRule = { mob };
  if (isRelationship(value['relationship'])) rule.relationship = value['relationship'];
  if (isBand(value['priority'])) rule.priority = value['priority'];
  if (typeof value['notHostile'] === 'boolean') rule.notHostile = value['notHostile'];
  if (typeof value['noBackstab'] === 'boolean') rule.noBackstab = value['noBackstab'];
  if (typeof value['stopToKill'] === 'boolean') rule.stopToKill = value['stopToKill'];
  const preAttack = asSpell(value['preAttack']);
  if (preAttack) rule.preAttack = preAttack;
  const attack = asSpell(value['attack']);
  if (attack) rule.attack = attack;
  return rule;
}

/** A list of rows, one per monster: a later row for the same monster is dropped. */
export function asMonsterRules(value: unknown): MonsterRule[] {
  if (!Array.isArray(value)) return [];
  const out: MonsterRule[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const rule = asMonsterRule(entry);
    if (rule === null || seen.has(rule.mob)) continue;
    seen.add(rule.mob);
    out.push(rule);
  }
  return out;
}

export function asMonsterTable(value: unknown): MonsterTable {
  if (!isRecord(value)) return EMPTY_MONSTER_TABLE;
  const rawSource = value['source'];
  const source =
    isRecord(rawSource) &&
    typeof rawSource['file'] === 'string' &&
    typeof rawSource['importedAt'] === 'string'
      ? { file: rawSource['file'], importedAt: rawSource['importedAt'] }
      : null;
  return { source, monsters: asMonsterRules(value['monsters']) };
}

/** Whether a row says anything at all beyond naming a monster. */
export function saysAnything(rule: MonsterRule): boolean {
  return Object.keys(rule).some((key) => key !== 'mob');
}

/* ------------------------------------------------------------ merging */

/**
 * Rows from broadest scope to narrowest, laid over each other field by field.
 *
 * A narrower row replaces only what it states: the realm's `flee` survives a
 * character's row that names nothing but an attack spell. Order is the
 * broadest list's, with monsters only a narrower scope names after it.
 */
export function mergeMonsterRules(...scopes: readonly (readonly MonsterRule[])[]): MonsterRule[] {
  const merged = new Map<string, MonsterRule>();
  for (const scope of scopes) {
    for (const row of scope) {
      const mob = mobKey(row.mob);
      if (mob.length === 0) continue;
      merged.set(mob, { ...merged.get(mob), ...row, mob });
    }
  }
  return [...merged.values()];
}

/**
 * Whether the realm's own monster table names a monster exactly, by `mobKey`.
 * What tells a modifier from the start of a different monster's name.
 */
export type KnownMob = (key: string) => boolean;

/**
 * The row that speaks for a monster the room named, or null.
 *
 * The exact name first. Failing that, the name with the realm's modifier
 * taken off — `guardsman` answers for `nasty guardsman`, because this family
 * hangs a word on either end of a base name (`mobNameCandidates`) — least
 * stripping first, which is what MegaMUD's *Find first* flag existed to
 * arrange by hand.
 *
 * **But only down to the realm's own name for it.** Where the realm's table
 * knows the monster — `orc rogue`, say — that is the monster, and a row for
 * anything shorter is a different one. Reported 2026-09-23: an imported
 * `rogue` row, marked Avoid, matched `large orc rogue` and `fierce orc rogue`
 * as whole words, and a character walked past both without swinging. With no
 * realm to ask (`known` absent, or naming none of the spellings) the shortest
 * stripping that finds a row is the only evidence there is, and it is used.
 */
export function ruleFor(
  rules: readonly MonsterRule[],
  name: string,
  known?: KnownMob
): MonsterRule | null {
  if (rules.length === 0) return null;
  const key = mobKey(name);
  const byMob = (mob: string): MonsterRule | null => rules.find((rule) => rule.mob === mob) ?? null;
  const exact = byMob(key);
  if (exact !== null) return exact;
  const stripped = mobNameCandidates(key).slice(1);
  if (known !== undefined) {
    if (known(key)) return null;
    for (const candidate of stripped) if (known(candidate)) return byMob(candidate);
  }
  for (const candidate of stripped) {
    const row = byMob(candidate);
    if (row !== null) return row;
  }
  return null;
}

/** The relationship a monster is treated with — `enemy` where nothing says. */
export function relationshipOf(
  rules: readonly MonsterRule[],
  name: string,
  known?: KnownMob
): Relationship {
  return ruleFor(rules, name, known)?.relationship ?? 'enemy';
}

/**
 * Whether the table says this monster will not open on the character — a row
 * marked Not hostile, or a friend. MegaMUD's reason for the flag: *this allows
 * MegaMMUD to rest within the room if needed before attacking the monster*.
 */
export function willNotOpen(
  rules: readonly MonsterRule[],
  name: string,
  known?: KnownMob
): boolean {
  const rule = ruleFor(rules, name, known);
  return rule !== null && (rule.notHostile === true || rule.relationship === 'friend');
}

/* ----------------------------------------------------------- the words */

export function relationshipLabel(relationship: Relationship, t: UiLookup): string {
  switch (relationship) {
    case 'friend':
      return t('monsters.relationships.friend');
    case 'avoid':
      return t('monsters.relationships.avoid');
    case 'enemy':
      return t('monsters.relationships.enemy');
    case 'escape':
      return t('monsters.relationships.escape');
    case 'hangup':
      return t('monsters.relationships.hangup');
  }
}

/* ---------------------------------------------------------- the session */

/**
 * A character's combat settings with its realm's table laid under its own
 * rows: `monsters` becomes what this character actually does about each.
 */
export function withRealmMonsters<T extends { monsters: MonsterRule[] }>(
  combat: T,
  realm: readonly MonsterRule[]
): T {
  if (realm.length === 0) return combat;
  return { ...combat, monsters: mergeMonsterRules(realm, combat.monsters) };
}
