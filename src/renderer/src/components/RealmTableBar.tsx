/**
 * The frame every imported realm table wears on the realm's page: what the
 * table holds and where it came from, the import button, the question before
 * an import replaces a table, and what the last action came to.
 *
 * One frame for every table (2026-09-24): `RealmMessages` and `RealmMonsters`
 * each drew their own copy, and the next MegaMUD import would have drawn a
 * third. What a table's rows are, how a file is read, and what else the bar
 * offers (`children`) stay with the table.
 */
import { useRef } from 'react';

import Icon from './Icon';

/** What the last import or save came to, or nothing to say. */
export type TableStatus = { tone: 'ok' | 'bad'; text: string } | null;

/** When a table was imported, or null where it says no date that reads. */
export function importedOn(source: { importedAt: string } | null | undefined): Date | null {
  if (!source) return null;
  const date = new Date(source.importedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface RealmTableBarProps {
  /** What the table holds, said on the bar. */
  summary: React.ReactNode;
  /** The file picker's filter, and its element id. */
  accept: string;
  inputId: string;
  importLabel: string;
  /** A file picked; the picker is cleared first, so the same file can be picked again. */
  onFile(file: File): void;
  /** The question before an import replaces the table, while one is waiting. */
  confirm: {
    text: string;
    replaceLabel: string;
    cancelLabel: string;
    onReplace(): void;
    onCancel(): void;
  } | null;
  status: TableStatus;
  /** Whatever else the bar offers, after the import button. */
  children?: React.ReactNode;
}

export default function RealmTableBar({
  summary,
  accept,
  inputId,
  importLabel,
  onFile,
  confirm,
  status,
  children
}: RealmTableBarProps): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="messages-bar">
        <span className="messages-summary">{summary}</span>
        <input
          accept={accept}
          hidden
          id={inputId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onFile(file);
          }}
          ref={fileRef}
          tabIndex={-1}
          type="file"
        />
        <button className="quiet" onClick={() => fileRef.current?.click()} type="button">
          <Icon name="plus" />
          <span>{importLabel}</span>
        </button>
        {children}
      </div>

      {confirm !== null && (
        <div className="messages-confirm">
          <span className="hint">{confirm.text}</span>
          <button className="danger" onClick={confirm.onReplace} type="button">
            {confirm.replaceLabel}
          </button>
          <button className="quiet" onClick={confirm.onCancel} type="button">
            {confirm.cancelLabel}
          </button>
        </div>
      )}

      {status !== null && (
        <p className={`messages-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}
