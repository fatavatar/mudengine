/**
 * A realm's message table, on the realm's page: import MegaMUD's
 * `Messages.md`, then read, switch off, edit and add rows.
 *
 * **Its own save, not the realm form's.** The form saves `server.yaml` as
 * somebody types; this table is its own file (`RealmTableStore`), six
 * hundred rows long, and a row is saved when its editor says so. Folding it
 * into the form's draft would make every keystroke in a login menu rewrite
 * the whole table.
 *
 * **The file comes from the viewer's own machine.** The realm database picker
 * browses the client's disk, because the database has to be read where the
 * client runs; a `Messages.md` is read here and its *text* crosses, so in a
 * browser tab the player picks the file on the computer in front of them —
 * which is where their MegaMUD is.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CheckField, SelectField, TextField } from './FormField';
import Icon from './Icon';
import RealmTableBar, { importedOn, type TableStatus } from './RealmTableBar';
import { t } from '../lib/i18n';
import {
  blankTrigger,
  MESSAGE_ACTIONS,
  MESSAGE_EFFECTS,
  messageActionLabel,
  messageEffectLabel,
  type MessageImport,
  type MessageTable,
  type MessageTrigger
} from '@shared/messageTriggers';

export interface RealmMessagesProps {
  /** The saved realm's name, or null for a realm not saved yet. */
  realm: string | null;
  load(realm: string): Promise<MessageTable>;
  importFile(realm: string, fileName: string, text: string): Promise<MessageImport>;
  save(realm: string, triggers: MessageTrigger[]): Promise<string | null>;
}

/** How many rows are drawn at once. The search narrows the rest. */
const SHOWN = 50;

/** A row being edited: which one (or a new one), and its draft. */
interface Editing {
  index: number | null;
  draft: MessageTrigger;
}

export default function RealmMessages({
  realm,
  load,
  importFile,
  save
}: RealmMessagesProps): React.JSX.Element {
  const [table, setTable] = useState<MessageTable | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<TableStatus>(null);
  /** A picked file waiting on *replace the table this realm has?* */
  const [pending, setPending] = useState<{ name: string; text: string } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (realm === null) return;
    setTable(await load(realm));
  }, [realm, load]);

  useEffect(() => {
    setTable(null);
    setEditing(null);
    setStatus(null);
    setPending(null);
    setQuery('');
    void reload();
  }, [reload]);

  const triggers = useMemo(() => table?.triggers ?? [], [table]);

  const matching = useMemo(() => {
    const words = query.trim().toLowerCase();
    return triggers
      .map((trigger, index) => ({ trigger, index }))
      .filter(
        ({ trigger }) =>
          words.length === 0 ||
          [trigger.name, trigger.match, trigger.endsWith, trigger.response].some((field) =>
            field.toLowerCase().includes(words)
          )
      );
  }, [triggers, query]);

  if (realm === null) {
    return <p className="settings-note">{t('settings.messages.saveFirst')}</p>;
  }

  const runImport = async (file: { name: string; text: string }): Promise<void> => {
    setPending(null);
    const result = await importFile(realm, file.name, file.text);
    if (!result.ok) {
      setStatus({ tone: 'bad', text: result.error });
      return;
    }
    setEditing(null);
    setQuery('');
    await reload();
    const parts = [
      result.count === 1
        ? t('settings.messages.imported.one')
        : t('settings.messages.imported.many', { count: result.count })
    ];
    if (result.chase > 0) parts.push(t('settings.messages.importedChase', { count: result.chase }));
    if (result.skipped.length > 0) {
      parts.push(
        t('settings.messages.importedSkipped', {
          count: result.skipped.length,
          lines: result.skipped
            .slice(0, 5)
            .map((skip) => skip.line)
            .join(', ')
        })
      );
    }
    setStatus({ tone: 'ok', text: parts.join(' ') });
  };

  const picked = async (file: File): Promise<void> => {
    let text: string;
    try {
      // MegaMUD is a Windows program and wrote the file in the Windows code
      // page; read as UTF-8, its one accented monster name would be mangled.
      text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
    } catch {
      setStatus({ tone: 'bad', text: t('settings.messages.unreadable') });
      return;
    }
    const chosen = { name: file.name, text };
    // Replacing a table is not undoable from here, so it is asked about --
    // but only when there is a table to lose.
    if (triggers.length > 0) setPending(chosen);
    else await runImport(chosen);
  };

  const write = async (next: MessageTrigger[], said: string): Promise<boolean> => {
    const refusal = await save(realm, next);
    if (refusal !== null) {
      setStatus({ tone: 'bad', text: refusal });
      return false;
    }
    setTable({ source: table?.source ?? null, triggers: next });
    setStatus({ tone: 'ok', text: said });
    return true;
  };

  const toggle = (index: number, enabled: boolean): void => {
    void write(
      triggers.map((trigger, at) => (at === index ? { ...trigger, enabled } : trigger)),
      enabled ? t('settings.messages.switchedOn') : t('settings.messages.switchedOff')
    );
  };

  const commit = async (): Promise<void> => {
    if (editing === null) return;
    const draft = {
      ...editing.draft,
      name: editing.draft.name.trim(),
      match: editing.draft.match.trim(),
      endsWith: editing.draft.endsWith.trim()
    };
    if (draft.match.length === 0) {
      setStatus({ tone: 'bad', text: t('settings.messages.needsMatch') });
      return;
    }
    const next =
      editing.index === null
        ? [...triggers, draft]
        : triggers.map((trigger, at) => (at === editing.index ? draft : trigger));
    if (await write(next, t('settings.messages.savedRow'))) setEditing(null);
  };

  const remove = async (): Promise<void> => {
    if (editing === null || editing.index === null) return;
    const index = editing.index;
    if (
      await write(
        triggers.filter((_, at) => at !== index),
        t('settings.messages.removedRow')
      )
    ) {
      setEditing(null);
    }
  };

  const patch = (change: Partial<MessageTrigger>): void =>
    setEditing((was) => (was === null ? was : { ...was, draft: { ...was.draft, ...change } }));

  const editor = (
    <div className="message-editor">
      <div className="settings-inline">
        <TextField
          label={t('settings.messages.nameLabel')}
          name="message-name"
          onChange={(value) => patch({ name: value })}
          onSubmit={() => void commit()}
          placeholder={t('settings.messages.namePlaceholder')}
          value={editing?.draft.name ?? ''}
        />
        <SelectField
          label={t('settings.messages.actionLabel')}
          name="message-action"
          onChange={(value) =>
            patch({ action: MESSAGE_ACTIONS.find((action) => action === value) ?? 'none' })
          }
          options={MESSAGE_ACTIONS.map((action) => ({
            value: action,
            label: messageActionLabel(action, t)
          }))}
          value={editing?.draft.action ?? 'none'}
        />
      </div>
      <TextField
        hint={t('settings.messages.matchHint')}
        label={t('settings.messages.matchLabel')}
        name="message-match"
        onChange={(value) => patch({ match: value })}
        onSubmit={() => void commit()}
        placeholder={t('settings.messages.matchPlaceholder')}
        spellCheck={false}
        value={editing?.draft.match ?? ''}
        wide
      />
      <TextField
        hint={t('settings.messages.endsWithHint')}
        label={t('settings.messages.endsWithLabel')}
        name="message-ends-with"
        onChange={(value) => patch({ endsWith: value })}
        onSubmit={() => void commit()}
        spellCheck={false}
        value={editing?.draft.endsWith ?? ''}
        wide
      />
      <TextField
        hint={t('settings.messages.responseHint')}
        label={t('settings.messages.responseLabel')}
        name="message-response"
        onChange={(value) => patch({ response: value })}
        onSubmit={() => void commit()}
        placeholder={t('settings.messages.responsePlaceholder')}
        spellCheck={false}
        value={editing?.draft.response ?? ''}
        wide
      />
      <div
        className="message-effects"
        role="group"
        aria-label={t('settings.messages.effectsLabel')}
      >
        <span className="message-effects-label">{t('settings.messages.effectsLabel')}</span>
        {MESSAGE_EFFECTS.map((effect) => {
          const on = editing?.draft.effects.includes(effect) ?? false;
          return (
            <button
              aria-pressed={on}
              className="chip pick"
              key={effect}
              onClick={() =>
                patch({
                  effects: MESSAGE_EFFECTS.filter((known) =>
                    known === effect ? !on : (editing?.draft.effects.includes(known) ?? false)
                  )
                })
              }
              type="button"
            >
              {messageEffectLabel(effect, t)}
            </button>
          );
        })}
      </div>
      <div className="settings-inline">
        <CheckField
          checked={editing?.draft.enabled ?? true}
          label={t('settings.messages.enabledLabel')}
          name="message-enabled"
          onChange={(value) => patch({ enabled: value })}
        />
        <CheckField
          checked={editing?.draft.conversations ?? false}
          hint={t('settings.messages.conversationsHint')}
          label={t('settings.messages.conversationsLabel')}
          name="message-conversations"
          onChange={(value) => patch({ conversations: value })}
        />
      </div>
      <div className="message-editor-actions">
        <button className="primary" onClick={() => void commit()} type="button">
          {t('settings.messages.saveRow')}
        </button>
        <button className="quiet" onClick={() => setEditing(null)} type="button">
          {t('settings.messages.cancel')}
        </button>
        {editing?.index !== null && editing?.index !== undefined && (
          <button className="danger" onClick={() => void remove()} type="button">
            {t('settings.messages.removeRow')}
          </button>
        )}
      </div>
    </div>
  );

  const chase = triggers.filter((trigger) => trigger.chase).length;
  const off = triggers.filter((trigger) => !trigger.enabled).length;
  const imported = importedOn(table?.source);

  return (
    <div className="realm-messages">
      <RealmTableBar
        accept=".md,.txt,text/plain"
        confirm={
          pending === null
            ? null
            : {
                text: t('settings.messages.confirmReplace', {
                  count: triggers.length,
                  file: pending.name
                }),
                replaceLabel: t('settings.messages.replace'),
                cancelLabel: t('settings.messages.cancel'),
                onReplace: () => void runImport(pending),
                onCancel: () => setPending(null)
              }
        }
        importLabel={t('settings.messages.import')}
        inputId="realm-messages-file"
        onFile={(file) => void picked(file)}
        status={status}
        summary={
          table === null
            ? t('settings.messages.loading')
            : triggers.length === 0
              ? t('settings.messages.none')
              : [
                  triggers.length === 1
                    ? t('settings.messages.count.one')
                    : t('settings.messages.count.many', { count: triggers.length }),
                  off > 0 ? t('settings.messages.countOff', { count: off }) : null,
                  chase > 0 ? t('settings.messages.countChase', { count: chase }) : null,
                  table.source && imported
                    ? t('settings.messages.source', {
                        file: table.source.file,
                        date: imported.toLocaleDateString()
                      })
                    : null
                ]
                  .filter((part): part is string => part !== null)
                  .join(' · ')
        }
      >
        <button
          className="quiet"
          onClick={() => setEditing({ index: null, draft: blankTrigger() })}
          type="button"
        >
          <Icon name="plus" />
          <span>{t('settings.messages.add')}</span>
        </button>
      </RealmTableBar>

      {editing !== null && editing.index === null && editor}

      {triggers.length > 0 && (
        <>
          <input
            aria-label={t('settings.messages.searchLabel')}
            className="messages-search"
            id="realm-messages-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The realm form around this saves on Enter; a search does not.
              if (event.key === 'Enter') event.preventDefault();
            }}
            placeholder={t('settings.messages.searchPlaceholder')}
            spellCheck={false}
            type="search"
            value={query}
          />
          <ul className="messages-list">
            {matching.slice(0, SHOWN).map(({ trigger, index }) => (
              <li className={trigger.enabled ? undefined : 'off'} key={index}>
                <div className="message-row">
                  <input
                    aria-label={t('settings.messages.enabledAria', {
                      name: trigger.name || trigger.match
                    })}
                    checked={trigger.enabled}
                    onChange={(event) => toggle(index, event.target.checked)}
                    type="checkbox"
                  />
                  <button
                    aria-expanded={editing?.index === index}
                    className="message-summary"
                    onClick={() =>
                      setEditing(editing?.index === index ? null : { index, draft: { ...trigger } })
                    }
                    type="button"
                  >
                    <span className="message-name">{trigger.name || '—'}</span>
                    <span className="message-match">{trigger.match}</span>
                    <span className="message-chips">
                      {trigger.chase && (
                        <span className="chip quiet">{t('settings.messages.chaseChip')}</span>
                      )}
                      {trigger.effects.map((effect) => (
                        <span className="chip info" key={effect}>
                          {messageEffectLabel(effect, t)}
                        </span>
                      ))}
                      {trigger.action !== 'none' && (
                        <span className="chip warn">{messageActionLabel(trigger.action, t)}</span>
                      )}
                      {trigger.response.length > 0 && (
                        <span className="chip">
                          {t('settings.messages.responseChip', { response: trigger.response })}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
                {editing?.index === index && editor}
              </li>
            ))}
          </ul>
          {matching.length > SHOWN && (
            <p className="settings-note">
              {t('settings.messages.more', { shown: SHOWN, count: matching.length })}
            </p>
          )}
          {matching.length === 0 && (
            <p className="settings-note">{t('settings.messages.noMatch')}</p>
          )}
        </>
      )}
    </div>
  );
}
