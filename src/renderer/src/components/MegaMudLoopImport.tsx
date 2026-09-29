/**
 * MegaMUD's loops onto a realm, from its data folder (2026-09-29).
 *
 * A folder rather than a file, because a MegaMUD loop is one `.mp` file of
 * hundreds and the room that places its start is in `Rooms.md` beside them.
 * The folder is the viewer's own — MegaMUD is on the machine somebody plays
 * from — so the browser's picker is the right one here, as it is for
 * `Messages.md`. It is read here and only its loops cross, as
 * `MegaMudPath`s: the files are megabytes and the loops a fraction of that
 * (`shared/megamudPaths.ts`). Main places each against the realm's map and
 * files what fits beside the realm's other loops.
 */
import { useCallback, useRef, useState } from 'react';

import type { LoopImport, MegaMudPath } from '@shared/megamudPaths';
import { megaMudLoops } from '@shared/megamudPaths';

import Icon from './Icon';
import type { TableStatus } from './RealmTableBar';
import { t } from '../lib/i18n';

export interface MegaMudLoopImportProps {
  /** The realm's name; null while there is no realm on disk to add to. */
  realm: string | null;
  importLoops(realm: string, paths: MegaMudPath[]): Promise<LoopImport>;
  /**
   * Called before anything crosses, so an edit still waiting to be saved on
   * the realm's page is written first — the page saves the whole list of
   * loops it holds, and one saved after the import would remove what it added.
   */
  beforeImport(): void;
  /** Called after loops were written, so the page takes up the list on disk. */
  onImported(): void;
}

/** What an import came to, in one sentence or two. */
function said(result: Extract<LoopImport, { ok: true }>, rooms: boolean): string {
  const parts = [
    result.count === 1
      ? t('settings.loopSection.imported.one', { replaced: result.replaced })
      : t('settings.loopSection.imported.many', {
          count: result.count,
          replaced: result.replaced
        })
  ];
  const { start, steps, short } = result.dropped;
  if (start + steps + short > 0) {
    parts.push(t('settings.loopSection.importDropped', { start, steps, short }));
  }
  if (!rooms) parts.push(t('settings.loopSection.importNoRooms'));
  return parts.join(' ');
}

export default function MegaMudLoopImport({
  realm,
  importLoops,
  beforeImport,
  onImported
}: MegaMudLoopImportProps): React.JSX.Element | null {
  const [status, setStatus] = useState<TableStatus>(null);
  const [busy, setBusy] = useState(false);

  /*
   * `webkitdirectory` is what makes the picker choose a folder, in every
   * browser and in Electron alike; React has no prop for it, so it is set on
   * the element itself.
   */
  const input = useRef<HTMLInputElement | null>(null);
  const folder = useCallback((element: HTMLInputElement | null) => {
    element?.setAttribute('webkitdirectory', '');
    input.current = element;
  }, []);

  const picked = async (list: readonly File[]): Promise<void> => {
    if (realm === null || list.length === 0) return;
    setBusy(true);
    setStatus({ tone: 'ok', text: t('settings.loopSection.importReading') });
    try {
      const wanted = list.filter(
        (file) => /\.mp$/i.test(file.name) || file.name.toLowerCase() === 'rooms.md'
      );
      // MegaMUD is a Windows program and writes in the Windows code page.
      const decoder = new TextDecoder('windows-1252');
      /*
       * One at a time: a MegaMUD folder is thousands of files (MudRev's
       * `Default` is 2,722), and asked for all at once Chrome refuses the
       * reads past what it will hold open with `NotReadableError`.
       */
      const files: { name: string; text: string }[] = [];
      for (const file of wanted) {
        files.push({ name: file.name, text: decoder.decode(await file.arrayBuffer()) });
      }
      const paths = megaMudLoops(files);
      if (paths.length === 0) {
        setStatus({ tone: 'bad', text: t('settings.loopSection.importNone') });
        return;
      }
      beforeImport();
      const result = await importLoops(realm, paths);
      if (!result.ok) {
        setStatus({ tone: 'bad', text: result.error });
        return;
      }
      const rooms = files.some((file) => file.name.toLowerCase() === 'rooms.md');
      setStatus({ tone: 'ok', text: said(result, rooms) });
      onImported();
    } catch (reason: unknown) {
      // The sentence on screen is generic; the cause must survive somewhere
      // it can be diagnosed from, as `useAutoSave` keeps its own.
      console.error('loop import failed', reason);
      setStatus({ tone: 'bad', text: t('settings.loopSection.importUnreadable') });
    } finally {
      setBusy(false);
    }
  };

  if (realm === null) return null;
  return (
    <>
      <input
        hidden
        id="realm-loops-import"
        multiple
        onChange={(event) => {
          // Cleared first, so the same folder can be picked again.
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void picked(files);
        }}
        ref={folder}
        tabIndex={-1}
        type="file"
      />
      <button
        className="quiet add-step"
        disabled={busy}
        onClick={() => input.current?.click()}
        type="button"
      >
        <Icon name="plus" />
        <span>{t('settings.loopSection.importLabel')}</span>
      </button>
      <p className="settings-note">{t('settings.loopSection.importNote')}</p>
      {status !== null && (
        <p className={`messages-status ${status.tone}`} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}
