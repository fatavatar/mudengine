/**
 * Each realm's monster table, on disk beside the realm.
 *
 * ```
 * servers/<id>/server.yaml     host, port, the menus
 * servers/<id>/messages.yaml   what the realm's sentences mean
 * servers/<id>/monsters.yaml   what to do about particular monsters
 * ```
 *
 * A file of its own for `RealmMessageStore`'s reasons: an imported table is
 * hundreds of rows, and `server.yaml` is the file somebody opens to fix a
 * login menu. Read on demand and cached by the file's size and time; watched
 * by an owned poll, so a table edited by hand reaches characters already
 * playing. See `shared/monsterRules.ts` for what a row says.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import type { Home } from '../app/home';
import { t } from '../app/i18n';
import {
  asMonsterTable,
  EMPTY_MONSTER_TABLE,
  type MonsterRule,
  type MonsterTable
} from '../../shared/monsterRules';
import { directoryNames } from './dirs';
import { Poller } from './Poller';
import { editYaml, type EditResult } from './YamlFile';

/** What the file is called inside a realm's directory. */
export const MONSTERS_FILE = 'monsters.yaml';

/** Said once at the top of a file this client creates. */
/** The paragraph at the head of a realm's table; `Migration` writes it too. */
export const MONSTERS_HEADER = ` What to do about particular monsters in this realm.

 Imported from MegaMUD's Monsters.md on the realm's settings page, and
 editable there. Each row names a monster and only what differs for it:
 relationship (friend, avoid, enemy, escape, hangup), priority (first, high,
 default, low, last), notHostile, noBackstab, stopToKill, and a preAttack or
 attack spell with the most casts (max, 0 for the combat setting's own).
 A character's own automation.combat.monsters rows are laid over these.`;

export interface RealmMonsterStoreEvents {
  change: () => void;
}

export declare interface RealmMonsterStore {
  on<E extends keyof RealmMonsterStoreEvents>(event: E, listener: RealmMonsterStoreEvents[E]): this;
  emit<E extends keyof RealmMonsterStoreEvents>(
    event: E,
    ...args: Parameters<RealmMonsterStoreEvents[E]>
  ): boolean;
}

export class RealmMonsterStore extends EventEmitter {
  private readonly cache = new Map<string, { stamp: string; table: MonsterTable }>();
  /** Files already reported as unreadable, by stamp, so a bad file is said once. */
  private readonly reported = new Set<string>();
  private readonly poller: Poller;

  constructor(
    private readonly home: Home,
    private readonly onError?: (message: string) => void
  ) {
    super();
    this.poller = new Poller({
      signature: () => this.signature(),
      reload: () => {
        this.poller.settle();
        this.emit('change');
      }
    });
    this.poller.settle();
  }

  /** Where one realm's table lives. */
  file(serverId: string): string {
    return path.join(this.home.server(serverId).dir, MONSTERS_FILE);
  }

  /**
   * One realm's table, or an empty one. A file that does not parse is reported
   * once and read as empty, for `RealmMessageStore.forServer`'s reason.
   */
  forServer(serverId: string): MonsterTable {
    const file = this.file(serverId);
    const stamp = this.stamp(file);
    if (stamp === null) return EMPTY_MONSTER_TABLE;
    const cached = this.cache.get(serverId);
    if (cached?.stamp === stamp) return cached.table;

    let table = EMPTY_MONSTER_TABLE;
    try {
      table = asMonsterTable(parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      if (!this.reported.has(`${file}:${stamp}`)) {
        this.reported.add(`${file}:${stamp}`);
        this.onError?.(
          t('notices.config.monsters.readError', {
            file,
            message: error instanceof Error ? error.message : 'unknown error'
          })
        );
      }
    }
    this.cache.set(serverId, { stamp, table });
    return table;
  }

  /** Replaces one realm's table, keeping the file's own comments. */
  write(serverId: string, table: MonsterTable): EditResult {
    const file = this.file(serverId);
    const creating = !fs.existsSync(file);
    const result = editYaml(file, {
      mutate: (document) => {
        if (creating) document.commentBefore = MONSTERS_HEADER;
        if (table.source === null) {
          if (document.hasIn(['source'])) document.deleteIn(['source']);
        } else {
          document.setIn(['source'], { ...table.source });
        }
        document.setIn(['monsters'], table.monsters.map(ruleForFile));
      },
      verify: (value) => {
        const back = asMonsterTable(value);
        return back.monsters.length === table.monsters.length
          ? null
          : t('notices.config.monsters.lostRows', {
              wrote: table.monsters.length,
              read: back.monsters.length
            });
      }
    });
    if (result.ok) {
      this.cache.delete(serverId);
      this.poller.settle();
      this.emit('change');
    }
    return result;
  }

  watch(): void {
    this.poller.start();
  }

  dispose(): void {
    this.poller.stop();
    this.removeAllListeners();
  }

  private stamp(file: string): string | null {
    try {
      const info = fs.statSync(file);
      return `${info.size}:${info.mtimeMs}`;
    } catch {
      return null;
    }
  }

  private signature(): string {
    let ids: string[] = [];
    try {
      ids = directoryNames(this.home.serversDir);
    } catch {
      return '';
    }
    return ids.map((id) => `${id}:${this.stamp(this.file(id)) ?? 'none'}`).join('|');
  }
}

/**
 * A row as the file holds it: the fields in a fixed order, and a spell with no
 * cap written as its bare name.
 */
function ruleForFile(rule: MonsterRule): Record<string, unknown> {
  const row: Record<string, unknown> = { mob: rule.mob };
  if (rule.relationship !== undefined) row['relationship'] = rule.relationship;
  if (rule.priority !== undefined) row['priority'] = rule.priority;
  if (rule.notHostile !== undefined) row['notHostile'] = rule.notHostile;
  if (rule.noBackstab !== undefined) row['noBackstab'] = rule.noBackstab;
  if (rule.stopToKill !== undefined) row['stopToKill'] = rule.stopToKill;
  if (rule.preAttack !== undefined) {
    row['preAttack'] = rule.preAttack.max > 0 ? { ...rule.preAttack } : rule.preAttack.spell;
  }
  if (rule.attack !== undefined) {
    row['attack'] = rule.attack.max > 0 ? { ...rule.attack } : rule.attack.spell;
  }
  return row;
}
