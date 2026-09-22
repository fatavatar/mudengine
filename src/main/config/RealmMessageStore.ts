/**
 * Each realm's message triggers, on disk beside the realm.
 *
 * ```
 * servers/<id>/server.yaml     host, port, the menus
 * servers/<id>/messages.yaml   what the realm's sentences mean
 * ```
 *
 * **A file of its own rather than a key in `server.yaml`.** An imported table
 * is six hundred rows, and `server.yaml` is the file somebody opens to fix a
 * login menu; burying the menus under a table would make the file that has to
 * stay readable the one that is not. It also keeps the realm's settings form,
 * which saves `server.yaml` on every keystroke, from rewriting six hundred
 * rows each time.
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
import { directoryNames } from './dirs';
import { Poller } from './Poller';
import { editYaml, type EditResult } from './YamlFile';

/** What the file is called inside a realm's directory. */
export const MESSAGES_FILE = 'messages.yaml';

/** Said once at the top of a file this client creates. */
const HEADER = ` What this realm's sentences mean, and what to send back.

 Imported from MegaMUD's Messages.md on the realm's settings page, and
 editable there. Each row: the sentence to find (match), the sentence that
 ends what it started (endsWith), what it means (effects), what to do
 (action), and what to send (response, in MegaMUD's syntax: ^M is Enter,
 ~ waits half a second, a||b picks one at random).`;

export interface RealmMessageStoreEvents {
  change: () => void;
}

export declare interface RealmMessageStore {
  on<E extends keyof RealmMessageStoreEvents>(event: E, listener: RealmMessageStoreEvents[E]): this;
  emit<E extends keyof RealmMessageStoreEvents>(
    event: E,
    ...args: Parameters<RealmMessageStoreEvents[E]>
  ): boolean;
}

export class RealmMessageStore extends EventEmitter {
  private readonly cache = new Map<string, { stamp: string; table: MessageTable }>();
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
    return path.join(this.home.server(serverId).dir, MESSAGES_FILE);
  }

  /**
   * One realm's table, or an empty one.
   *
   * A file that does not parse is reported once and read as empty rather than
   * as whatever part of it parsed: half a table is a table that responds to
   * some sentences and not others, with nothing saying which.
   */
  forServer(serverId: string): MessageTable {
    const file = this.file(serverId);
    const stamp = this.stamp(file);
    if (stamp === null) return EMPTY_MESSAGE_TABLE;
    const cached = this.cache.get(serverId);
    if (cached?.stamp === stamp) return cached.table;

    let table = EMPTY_MESSAGE_TABLE;
    try {
      table = asMessageTable(parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      if (!this.reported.has(`${file}:${stamp}`)) {
        this.reported.add(`${file}:${stamp}`);
        this.onError?.(
          t('notices.config.messages.readError', {
            file,
            message: error instanceof Error ? error.message : 'unknown error'
          })
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
  write(serverId: string, table: MessageTable): EditResult {
    const file = this.file(serverId);
    const creating = !fs.existsSync(file);
    const result = editYaml(file, {
      mutate: (document) => {
        if (creating) document.commentBefore = HEADER;
        if (table.source === null) {
          if (document.hasIn(['source'])) document.deleteIn(['source']);
        } else {
          document.setIn(['source'], { ...table.source });
        }
        document.setIn(['messages'], table.triggers.map(triggerForFile));
      },
      verify: (value) => {
        const back = asMessageTable(value);
        return back.triggers.length === table.triggers.length
          ? null
          : t('notices.config.messages.lostRows', {
              wrote: table.triggers.length,
              read: back.triggers.length
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
