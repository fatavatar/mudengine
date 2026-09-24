/**
 * Rows of what to do about particular monsters (`shared/monsterRules.ts`):
 * a searchable list, a row that opens into its editor, and a way to add one.
 *
 * Shared by the realm's imported table (`RealmMonsters`) and a character's
 * own rows, which are laid over it field by field — so every field here has
 * an *unset* choice, and unset is what lets a character's row name only the
 * spell and keep the realm's relationship.
 *
 * The list keeps the message table's look (`.realm-messages` and friends):
 * both are a few hundred one-line rows to search, not read.
 */
import { useMemo, useState } from 'react';

import FormField, { NumberField, SelectField, TextField } from './FormField';
import Icon from './Icon';
import NameCombo from './NameCombo';
import { t } from '../lib/i18n';
import type { MobPriorityBand } from '@shared/config';
import {
  RELATIONSHIPS,
  relationshipLabel,
  type MonsterRule,
  type MonsterSpell
} from '@shared/monsterRules';

/** How many rows are drawn at once. The search narrows the rest. */
const SHOWN = 50;

// All five, `default` included: on a character's row it undoes a realm's band,
// which leaving the field unset would not.
const BANDS: readonly MobPriorityBand[] = ['first', 'high', 'default', 'low', 'last'];

type Flag = 'notHostile' | 'noBackstab' | 'stopToKill';
const FLAGS: readonly Flag[] = ['notHostile', 'noBackstab', 'stopToKill'];

function flagLabel(flag: Flag): string {
  switch (flag) {
    case 'notHostile':
      return t('settings.monsters.flags.notHostile');
    case 'noBackstab':
      return t('settings.monsters.flags.noBackstab');
    case 'stopToKill':
      return t('settings.monsters.flags.stopToKill');
  }
}

/** One literal `t()` per band, for `i18n-coverage.test.ts`. */
const BAND_WORD: Record<MobPriorityBand, () => string> = {
  first: () => t('settings.monsters.bands.first'),
  high: () => t('settings.monsters.bands.high'),
  default: () => t('settings.monsters.bands.default'),
  low: () => t('settings.monsters.bands.low'),
  last: () => t('settings.monsters.bands.last')
};

function bandLabel(band: MobPriorityBand): string {
  return BAND_WORD[band]();
}

/** A spell as the row's chips say it: its word, and its cap where one is set. */
function spellText(spell: MonsterSpell): string {
  return spell.max > 0 ? `${spell.spell} ×${spell.max}` : spell.spell;
}

interface Editing {
  /** The row's monster when editing one, or null for a new row. */
  mob: string | null;
  draft: MonsterRule;
}

export interface MonsterRuleListProps {
  rows: readonly MonsterRule[];
  /**
   * Replace the rows. Resolves to a refusal, or null once saved — the list
   * closes the editor only on null.
   */
  onChange(rows: MonsterRule[], said: string): Promise<string | null>;
  /** Name prefix for the fields, so two lists on one page stay distinct. */
  namePrefix: string;
  /** What the add button says. */
  addLabel: string;
  /** Said when there are no rows. */
  emptyText: string;
  /**
   * Monster names to suggest for a row — the realm's own and its imported
   * table's. Suggestions only: the field stays free text, because a realm the
   * client holds no data for still has monsters, and a row may name only part
   * of a monster.
   */
  known?: readonly string[];
}

export function MonsterRuleList({
  rows,
  onChange,
  namePrefix,
  addLabel,
  emptyText,
  known = []
}: MonsterRuleListProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const matching = useMemo(() => {
    const words = query.trim().toLowerCase();
    return rows.filter((row) => words.length === 0 || row.mob.includes(words));
  }, [rows, query]);

  const write = async (next: MonsterRule[], said: string): Promise<boolean> => {
    const refusal = await onChange(next, said);
    if (refusal !== null) {
      setStatus({ tone: 'bad', text: refusal });
      return false;
    }
    setStatus({ tone: 'ok', text: said });
    return true;
  };

  const commit = async (): Promise<void> => {
    if (editing === null) return;
    const mob = editing.draft.mob.trim().toLowerCase();
    if (mob.length === 0) {
      setStatus({ tone: 'bad', text: t('settings.monsters.needsName') });
      return;
    }
    const draft: MonsterRule = { ...editing.draft, mob };
    const clash = rows.some((row) => row.mob === mob && row.mob !== editing.mob);
    if (clash) {
      setStatus({ tone: 'bad', text: t('settings.monsters.duplicate', { mob }) });
      return;
    }
    const next =
      editing.mob === null
        ? [...rows, draft]
        : rows.map((row) => (row.mob === editing.mob ? draft : row));
    if (await write(next, t('settings.monsters.savedRow'))) setEditing(null);
  };

  const remove = async (): Promise<void> => {
    if (editing === null || editing.mob === null) return;
    const gone = editing.mob;
    if (
      await write(
        rows.filter((row) => row.mob !== gone),
        t('settings.monsters.removedRow')
      )
    ) {
      setEditing(null);
    }
  };

  const patch = (change: Partial<MonsterRule>): void =>
    setEditing((was) => (was === null ? was : { ...was, draft: { ...was.draft, ...change } }));

  /** Sets or clears one optional field; `undefined` removes the key outright. */
  const setField = <K extends keyof MonsterRule>(key: K, value: MonsterRule[K] | undefined): void =>
    setEditing((was) => {
      if (was === null) return was;
      const draft = { ...was.draft };
      if (value === undefined) delete draft[key];
      else draft[key] = value;
      return { ...was, draft };
    });

  const spellField = (key: 'preAttack' | 'attack', label: string, hint: string) => {
    const spell = editing?.draft[key];
    return (
      <div className="settings-inline">
        <TextField
          hint={hint}
          label={label}
          name={`${namePrefix}-${key}`}
          onChange={(value) => {
            const word = value.trim();
            setField(key, word.length === 0 ? undefined : { spell: value, max: spell?.max ?? 0 });
          }}
          onSubmit={() => void commit()}
          spellCheck={false}
          value={spell?.spell ?? ''}
        />
        <NumberField
          label={t('settings.monsters.maxLabel')}
          name={`${namePrefix}-${key}-max`}
          onChange={(value) => {
            if (spell === undefined) return;
            const max = Number.parseInt(value, 10);
            setField(key, { ...spell, max: Number.isFinite(max) && max > 0 ? max : 0 });
          }}
          placeholder="0"
          value={spell !== undefined && spell.max > 0 ? String(spell.max) : ''}
        />
      </div>
    );
  };

  const editor = (
    <div className="message-editor">
      <div className="settings-inline">
        <FormField
          hint={t('settings.monsters.nameHint')}
          label={t('settings.monsters.nameLabel')}
          name={`${namePrefix}-mob`}
        >
          {({ describedBy }) => (
            <NameCombo
              describedBy={describedBy}
              name={`${namePrefix}-mob`}
              onChange={(value) => patch({ mob: value })}
              options={known}
              placeholder={t('settings.monsters.namePlaceholder')}
              value={editing?.draft.mob ?? ''}
            />
          )}
        </FormField>
        <SelectField
          label={t('settings.monsters.relationshipLabel')}
          name={`${namePrefix}-relationship`}
          onChange={(value) =>
            setField(
              'relationship',
              RELATIONSHIPS.find((relationship) => relationship === value)
            )
          }
          options={[
            { value: '', label: t('settings.monsters.unset') },
            ...RELATIONSHIPS.map((relationship) => ({
              value: relationship,
              label: relationshipLabel(relationship, t)
            }))
          ]}
          value={editing?.draft.relationship ?? ''}
        />
        <SelectField
          label={t('settings.monsters.priorityLabel')}
          name={`${namePrefix}-priority`}
          onChange={(value) =>
            setField(
              'priority',
              BANDS.find((band) => band === value)
            )
          }
          options={[
            { value: '', label: t('settings.monsters.unset') },
            ...BANDS.map((band) => ({ value: band, label: bandLabel(band) }))
          ]}
          value={editing?.draft.priority ?? ''}
        />
      </div>
      <div className="message-effects" role="group" aria-label={t('settings.monsters.flagsLabel')}>
        <span className="message-effects-label">{t('settings.monsters.flagsLabel')}</span>
        {FLAGS.map((flag) => {
          const on = editing?.draft[flag] === true;
          return (
            <button
              aria-pressed={on}
              className="chip pick"
              key={flag}
              onClick={() => setField(flag, on ? undefined : true)}
              type="button"
            >
              {flagLabel(flag)}
            </button>
          );
        })}
      </div>
      {spellField(
        'preAttack',
        t('settings.monsters.preAttackLabel'),
        t('settings.monsters.preAttackHint')
      )}
      {spellField('attack', t('settings.monsters.attackLabel'), t('settings.monsters.attackHint'))}
      <div className="message-editor-actions">
        <button className="primary" onClick={() => void commit()} type="button">
          {t('settings.monsters.saveRow')}
        </button>
        <button className="quiet" onClick={() => setEditing(null)} type="button">
          {t('settings.monsters.cancel')}
        </button>
        {editing?.mob !== null && editing?.mob !== undefined && (
          <button className="danger" onClick={() => void remove()} type="button">
            {t('settings.monsters.removeRow')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="messages-bar">
        <span className="messages-summary">
          {rows.length === 0
            ? emptyText
            : rows.length === 1
              ? t('settings.monsters.count.one')
              : t('settings.monsters.count.many', { count: rows.length })}
        </span>
        <button
          className="quiet"
          onClick={() => setEditing({ mob: null, draft: { mob: '' } })}
          type="button"
        >
          <Icon name="plus" />
          <span>{addLabel}</span>
        </button>
      </div>

      {status !== null && (
        <p className={`messages-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}

      {editing !== null && editing.mob === null && editor}

      {rows.length > 0 && (
        <>
          <input
            aria-label={t('settings.monsters.searchLabel')}
            className="messages-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The form around this saves on Enter; a search does not.
              if (event.key === 'Enter') event.preventDefault();
            }}
            placeholder={t('settings.monsters.searchPlaceholder')}
            spellCheck={false}
            type="search"
            value={query}
          />
          <ul className="messages-list">
            {matching.slice(0, SHOWN).map((row) => (
              <li key={row.mob}>
                <div className="message-row">
                  <button
                    aria-expanded={editing?.mob === row.mob}
                    className="message-summary"
                    onClick={() =>
                      setEditing(
                        editing?.mob === row.mob ? null : { mob: row.mob, draft: { ...row } }
                      )
                    }
                    type="button"
                  >
                    <span className="message-name">{row.mob}</span>
                    <span className="message-chips">
                      {row.relationship !== undefined && (
                        <span
                          className={
                            row.relationship === 'escape' || row.relationship === 'hangup'
                              ? 'chip warn'
                              : 'chip info'
                          }
                        >
                          {relationshipLabel(row.relationship, t)}
                        </span>
                      )}
                      {row.priority !== undefined && (
                        <span className="chip quiet">{bandLabel(row.priority)}</span>
                      )}
                      {FLAGS.filter((flag) => row[flag] === true).map((flag) => (
                        <span className="chip quiet" key={flag}>
                          {flagLabel(flag)}
                        </span>
                      ))}
                      {row.preAttack !== undefined && (
                        <span className="chip">
                          {t('settings.monsters.preAttackChip', {
                            spell: spellText(row.preAttack)
                          })}
                        </span>
                      )}
                      {row.attack !== undefined && (
                        <span className="chip">
                          {t('settings.monsters.attackChip', { spell: spellText(row.attack) })}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
                {editing?.mob === row.mob && editor}
              </li>
            ))}
          </ul>
          {matching.length > SHOWN && (
            <p className="settings-note">
              {t('settings.monsters.more', { shown: SHOWN, count: matching.length })}
            </p>
          )}
          {matching.length === 0 && (
            <p className="settings-note">{t('settings.monsters.noMatch')}</p>
          )}
        </>
      )}
    </>
  );
}
