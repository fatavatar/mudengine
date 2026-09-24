/**
 * A realm's imported tables, each on disk beside the realm.
 *
 * ```
 * servers/<id>/server.yaml     host, port, the menus
 * servers/<id>/messages.yaml   what the realm's sentences mean
 * servers/<id>/monsters.yaml   what to do about particular monsters
 * ```
 *
 * **A file of its own rather than a key in `server.yaml`.** An imported table
 * is hundreds of rows, and `server.yaml` is the file somebody opens to fix a
 * login menu; burying the menus under a table would make the file that has to
 * stay readable the one that is not. It also keeps the realm's settings form,
 * which saves `server.yaml` on every keystroke, from rewriting every row each
 * time.
 *
 * **One store, a kind per table** (2026-09-24). Messages.md and Monsters.md
 * were two copies of this class that differed in a file name, a header and a
 * parser, and the next MegaMUD import would have been a third. A table is now
 * a `TableKind`: what differs, and nothing else.
 *
 * Read on demand and cached by the file's size and time, because it is asked
 * for whenever a session is (re)configured and almost never changes. Watched
 * by an owned poll like every file the user owns (see `ConfigStore` for why
 * not `fs.watch`), so a table edited by hand reaches characters already
 * playing.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import type { Home } from '../app/home';
import { t } from '../app/i18n';
import {
  asMessageTable,
  EMPTY_MESSAGE_TABLE,
  triggerForFile,
  type MessageTable
} from '../../shared/messageTriggers';
import {
  asMonsterTable,
  EMPTY_MONSTER_TABLE,
  type MonsterRule,
  type MonsterTable
} from '../../shared/monsterRules';
import { directoryNames } from './dirs';
import { Poller } from './Poller';
import { editYaml, type EditResult } from './YamlFile';

/** What every realm table has: where it was imported from, if it was. */
export interface RealmTable {
  source: { file: string; importedAt: string } | null;
}

/** What one kind of realm table is: its file, its words, and how its rows read and write. */
export interface TableKind<Table extends RealmTable> {
  /** What the file is called inside a realm's directory. */
  file: string;
  /** Said once at the top of a file this client creates. */
  header: string;
  /** The key the rows sit under. */
  key: string;
  empty: Table;
  /** A parsed file as a table, never throwing: what is not a row is dropped. */
  read(value: unknown): Table;
  /** The rows as the file holds them. */
  rowsForFile(table: Table): unknown[];
  /** Said once for a file that does not parse. */
  readError(file: string, message: string): string;
  /** Said when a write read back fewer rows than it wrote. */
  lostRows(wrote: number, read: number): string;
}

export const MESSAGE_TABLE: TableKind<MessageTable> = {
  file: 'messages.yaml',
  header: ` What this realm's sentences mean, and what to send back.

 Imported from MegaMUD's Messages.md on the realm's settings page, and
 editable there. Each row: the sentence to find (match), the sentence that
 ends what it started (endsWith), what it means (effects), what to do
 (action), and what to send (response, in MegaMUD's syntax: ^M is Enter,
 ~ waits half a second, a||b picks one at random).`,
  key: 'messages',
  empty: EMPTY_MESSAGE_TABLE,
  read: asMessageTable,
  rowsForFile: (table) => table.triggers.map(triggerForFile),
  readError: (file, message) => t('notices.config.messages.readError', { file, message }),
  lostRows: (wrote, read) => t('notices.config.messages.lostRows', { wrote, read })
};

export const MONSTER_TABLE: TableKind<MonsterTable> = {
  file: 'monsters.yaml',
  // `Migration` writes this header too, over a table it moves out of a profile.
  header: ` What to do about particular monsters in this realm.

 Imported from MegaMUD's Monsters.md on the realm's settings page, and
 editable there. Each row names a monster and only what differs for it:
 relationship (friend, avoid, enemy, escape, hangup), priority (first, high,
 default, low, last), notHostile, noBackstab, stopToKill, and a preAttack or
 attack spell with the most casts (max, 0 for the combat setting's own).
 A character's own automation.combat.monsters rows are laid over these.`,
  key: 'monsters',
  empty: EMPTY_MONSTER_TABLE,
  read: asMonsterTable,
  rowsForFile: (table) => table.monsters.map(ruleForFile),
  readError: (file, message) => t('notices.config.monsters.readError', { file, message }),
  lostRows: (wrote, read) => t('notices.config.monsters.lostRows', { wrote, read })
};

export interface RealmTableStoreEvents {
  change: () => void;
}

export declare interface RealmTableStore<Table extends RealmTable> {
  on<E extends keyof RealmTableStoreEvents>(event: E, listener: RealmTableStoreEvents[E]): this;
  emit<E extends keyof RealmTableStoreEvents>(
    event: E,
    ...args: Parameters<RealmTableStoreEvents[E]>
  ): boolean;
}

export class RealmTableStore<Table extends RealmTable> extends EventEmitter {
  private readonly cache = new Map<string, { stamp: string; table: Table }>();
  /** Files already reported as unreadable, by stamp, so a bad file is said once. */
  private readonly reported = new Set<string>();
  private readonly poller: Poller;

  constructor(
    private readonly home: Home,
    readonly kind: TableKind<Table>,
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
    return path.join(this.home.server(serverId).dir, this.kind.file);
  }

  /**
   * One realm's table, or an empty one.
   *
   * A file that does not parse is reported once and read as empty rather than
   * as whatever part of it parsed: half a table is a table that answers some
   * sentences, or some monsters, and not others, with nothing saying which.
   */
  forServer(serverId: string): Table {
    const file = this.file(serverId);
    const stamp = this.stamp(file);
    if (stamp === null) return this.kind.empty;
    const cached = this.cache.get(serverId);
    if (cached?.stamp === stamp) return cached.table;

    let table = this.kind.empty;
    try {
      table = this.kind.read(parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      if (!this.reported.has(`${file}:${stamp}`)) {
        this.reported.add(`${file}:${stamp}`);
        this.onError?.(
          this.kind.readError(file, error instanceof Error ? error.message : 'unknown error')
        );
      }
    }
    this.cache.set(serverId, { stamp, table });
    return table;
  }

  /**
   * Replaces one realm's table, keeping the file's own comments.
   *
   * The whole table rather than a row: the settings screen holds all of it,
   * and a row addressed by position is a row that moves when another is
   * removed.
   */
  write(serverId: string, table: Table): EditResult {
    const file = this.file(serverId);
    const creating = !fs.existsSync(file);
    const rows = this.kind.rowsForFile(table);
    const result = editYaml(file, {
      mutate: (document) => {
        if (creating) document.commentBefore = this.kind.header;
        if (table.source === null) {
          if (document.hasIn(['source'])) document.deleteIn(['source']);
        } else {
          document.setIn(['source'], { ...table.source });
        }
        document.setIn([this.kind.key], rows);
      },
      verify: (value) => {
        const back = this.kind.rowsForFile(this.kind.read(value)).length;
        return back === rows.length ? null : this.kind.lostRows(rows.length, back);
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
 * A monster row as the file holds it: the fields in a fixed order, and a spell
 * with no cap written as its bare name.
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
