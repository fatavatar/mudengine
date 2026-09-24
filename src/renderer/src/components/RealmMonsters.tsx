/**
 * A realm's monster table, on the realm's page: import MegaMUD's
 * `Monsters.md`, then read, edit and add rows.
 *
 * **Decoded here, in the window.** The file is MegaMUD's binary database on
 * the player's own machine — in a browser tab, not the machine the client
 * runs on — and 700 KB of it is most of the web socket's message cap. The
 * rows it yields are what cross (`shared/megamudDb.ts`), and only the ones
 * that say something: a monster MegaMUD treats as a plain enemy at normal
 * priority is how an unlisted monster is treated already.
 *
 * Its own save, not the realm form's, for `RealmMessages`' reason.
 */
import { useCallback, useEffect, useState } from 'react';

import { MonsterRuleList } from './MonsterRules';
import RealmTableBar, { importedOn, type TableStatus } from './RealmTableBar';
import { t } from '../lib/i18n';
import { readMegaMudMonsters } from '@shared/megamudDb';
import {
  saysAnything,
  type MonsterImport,
  type MonsterRule,
  type MonsterTable
} from '@shared/monsterRules';

export interface RealmMonstersProps {
  /** The saved realm's name, or null for a realm not saved yet. */
  realm: string | null;
  load(realm: string): Promise<MonsterTable>;
  importRows(realm: string, fileName: string, monsters: MonsterRule[]): Promise<MonsterImport>;
  save(realm: string, monsters: MonsterRule[]): Promise<string | null>;
}

export default function RealmMonsters({
  realm,
  load,
  importRows,
  save
}: RealmMonstersProps): React.JSX.Element {
  const [table, setTable] = useState<MonsterTable | null>(null);
  const [status, setStatus] = useState<TableStatus>(null);
  /** A decoded file waiting on *replace the table this realm has?* */
  const [pending, setPending] = useState<{
    name: string;
    rows: MonsterRule[];
    read: number;
  } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (realm === null) return;
    setTable(await load(realm));
  }, [realm, load]);

  useEffect(() => {
    setTable(null);
    setStatus(null);
    setPending(null);
    void reload();
  }, [reload]);

  if (realm === null) {
    return <p className="settings-note">{t('settings.monsters.saveFirst')}</p>;
  }

  const rows = table?.monsters ?? [];

  const runImport = async (file: { name: string; rows: MonsterRule[]; read: number }) => {
    setPending(null);
    const result = await importRows(realm, file.name, file.rows);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.error });
      return;
    }
    await reload();
    setStatus({
      tone: 'ok',
      text: t('settings.monsters.imported', { count: result.count, read: file.read })
    });
  };

  const picked = async (file: File): Promise<void> => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setStatus({ tone: 'bad', text: t('settings.monsters.unreadable') });
      return;
    }
    const monsters = readMegaMudMonsters(bytes);
    if (monsters.length === 0) {
      setStatus({ tone: 'bad', text: t('settings.monsters.notMonsters', { file: file.name }) });
      return;
    }
    /*
     * One row per monster name, the first kept. MegaMUD's own database holds
     * several monsters of one name (`dark priest` twice, `Nahr` five times),
     * and a row is keyed by the name the room prints.
     */
    const seen = new Set<string>();
    const kept: MonsterRule[] = [];
    for (const monster of monsters) {
      if (!saysAnything(monster.rule) || seen.has(monster.rule.mob)) continue;
      seen.add(monster.rule.mob);
      kept.push(monster.rule);
    }
    if (kept.length === 0) {
      setStatus({
        tone: 'bad',
        text: t('settings.monsters.nothingSaid', { count: monsters.length, file: file.name })
      });
      return;
    }
    const chosen = { name: file.name, rows: kept, read: monsters.length };
    // Replacing a table is not undoable from here, so it is asked about --
    // but only when there is a table to lose.
    if (rows.length > 0) setPending(chosen);
    else await runImport(chosen);
  };

  // The list says what happened to a row itself; this only keeps the table.
  const change = async (next: MonsterRule[]): Promise<string | null> => {
    const refusal = await save(realm, next);
    if (refusal === null) {
      setTable({ source: table?.source ?? null, monsters: next });
      setStatus(null);
    }
    return refusal;
  };

  const imported = importedOn(table?.source);

  return (
    <div className="realm-messages">
      <RealmTableBar
        accept=".md,.bak"
        confirm={
          pending === null
            ? null
            : {
                text: t('settings.monsters.confirmReplace', {
                  count: rows.length,
                  file: pending.name
                }),
                replaceLabel: t('settings.monsters.replace'),
                cancelLabel: t('settings.monsters.cancel'),
                onReplace: () => void runImport(pending),
                onCancel: () => setPending(null)
              }
        }
        importLabel={t('settings.monsters.import')}
        inputId="realm-monsters-file"
        onFile={(file) => void picked(file)}
        status={status}
        summary={
          table === null
            ? t('settings.monsters.loading')
            : table.source && imported
              ? t('settings.monsters.source', {
                  file: table.source.file,
                  date: imported.toLocaleDateString()
                })
              : null
        }
      />

      {table !== null && (
        <MonsterRuleList
          addLabel={t('settings.monsters.add')}
          emptyText={t('settings.monsters.none')}
          namePrefix="realm-monster"
          onChange={change}
          rows={rows}
        />
      )}
    </div>
  );
}
