/**
 * MegaMUD's recorded paths, read (2026-09-29).
 *
 * A path file (`*.mp`) is text. Its first line is `[title][author]`; the
 * room it starts from, and for a path that goes somewhere the room it ends
 * in, follow as `[CODE:Area:Room name]`; then one line of room codes, and one
 * line per step:
 *
 * ```
 * [Ancient Crypt-1 1943][]
 * [ACRY:Island:Ancient Crypt]
 * 3C900060:3C900060:32:-1:0:::
 * 3C900060:0000:w
 * ```
 *
 * The codes line opens with the start room's code and the end room's. A
 * **loop** is a path whose two are the same room — which is how MegaMUD
 * itself tells them apart, and finds 282 in its MudRev `Default` folder where
 * a `LOOP` in the file name finds 223, one of them not a loop at all.
 *
 * `Rooms.md` beside the paths is text too, one room per line, and its name
 * for a room usually carries the realm's coordinates, typed by whoever
 * recorded it: `3C900060:00000000:0:0:0:ACRY:Island:Ancient Crypt-1 1943`.
 * That is what places a loop's first room in the realm (`megamudLoops.ts`).
 *
 * The window reads the folder and sends what it read, as `MegaMudPath`s,
 * rather than the files: 282 loop files are half a megabyte and a web
 * socket's message is capped (`tuning.web.maxMessageBytes`), where their
 * titles, start rooms and steps are a fraction of it.
 */
import type { Loop } from './loops';

/** One recorded loop, as the window read it and main converts it. */
export interface MegaMudPath {
  /** The file it came from, so two with one title are numbered the same way every time. */
  file: string;
  /** The first line's title, as the recorder typed it. Often carries coordinates. */
  title: string;
  /** The area MegaMUD filed it under. */
  area: string;
  /** The start room as the header names it. */
  start: string;
  /** `Rooms.md`'s name for the start room, when the folder has one: usually with coordinates. */
  startRow: string | null;
  /** Each step's command, in order: a direction, or anything else sent on the way. */
  steps: string[];
}

/** What an import did: how many loops it wrote, and how many it could not place and why. */
export type LoopImport =
  | {
      ok: true;
      count: number;
      /** Loops that replaced one of the same name already here. */
      replaced: number;
      dropped: LoopsDropped;
    }
  | { ok: false; error: string };

/** Loops not brought across, by reason. A guessed loop walks somewhere nobody meant. */
export interface LoopsDropped {
  /** The realm data has no room the start could be placed in. */
  start: number;
  /** A recorded direction is not an exit of the room the replay had reached. */
  steps: number;
  /** Replayed to fewer than two places. */
  short: number;
}

/** Ceilings on a payload that crossed the wire, not on a MegaMUD folder. */
export const MEGAMUD_PATH_LIMITS = { paths: 2000, steps: 5000, text: 200 } as const;

const TITLE = /^\[([^\]]*)\]\[([^\]]*)\]$/;
const ROOM = /^\[(\w{1,8}):([^:\]]*):(.+)\]$/;
const CODES = /^([0-9A-F]{8}):([0-9A-F]{8}):/i;
const STEP = /^[0-9A-F]{8}:[0-9A-F]{4}:(.*)$/i;

/**
 * One path file as a loop, or null when it is not one.
 *
 * Steps begin at the first `<room>:<flags>:<command>` line rather than at a
 * fixed line: a goto path names two rooms where a loop names one, and a
 * recorder may add a second title line (`Dhelloop.mp`).
 */
export function readMegaMudLoop(
  file: string,
  text: string,
  rooms: ReadonlyMap<string, string> = new Map()
): MegaMudPath | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const codes = lines.map((line) => CODES.exec(line)).find((found) => found !== null);
  if (!codes || codes[1]!.toUpperCase() !== codes[2]!.toUpperCase()) return null;
  const room = lines.map((line) => ROOM.exec(line)).find((found) => found !== null);
  if (!room) return null;
  return {
    file,
    title: (
      lines.map((line) => TITLE.exec(line)).find((found) => found !== null)?.[1] ?? ''
    ).trim(),
    area: room[2]!.trim(),
    start: room[3]!.trim(),
    startRow: rooms.get(codes[1]!.toUpperCase()) ?? null,
    steps: lines
      .map((line) => STEP.exec(line)?.[1]?.trim())
      .filter((step): step is string => step !== undefined && step.length > 0)
  };
}

/** `Rooms.md` as room code → the name it gives that room. */
export function readMegaMudRooms(text: string): Map<string, string> {
  const rooms = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(':');
    if (fields.length < 8 || !/^[0-9A-F]{8}$/i.test(fields[0]!)) continue;
    const name = fields.slice(7).join(':').trim();
    if (name.length > 0) rooms.set(fields[0]!.toUpperCase(), name);
  }
  return rooms;
}

/**
 * The loops in a MegaMUD folder, from its files as the window read them.
 * Everything that is not a loop, and every file that is not a path, is left
 * out; `Rooms.md` is found among them by name.
 */
export function megaMudLoops(files: readonly { name: string; text: string }[]): MegaMudPath[] {
  const table = files.find((file) => file.name.toLowerCase() === 'rooms.md');
  const rooms = table ? readMegaMudRooms(table.text) : new Map<string, string>();
  return files
    .filter((file) => /\.mp$/i.test(file.name))
    .map((file) => readMegaMudLoop(file.name, file.text, rooms))
    .filter((path): path is MegaMudPath => path !== null);
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MEGAMUD_PATH_LIMITS.text) : '';

/** Paths from a payload that crossed the wire: parsed, never trusted. */
export function asMegaMudPaths(value: unknown): MegaMudPath[] {
  if (!Array.isArray(value)) return [];
  const paths: MegaMudPath[] = [];
  for (const entry of value.slice(0, MEGAMUD_PATH_LIMITS.paths)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const steps = Array.isArray(record['steps'])
      ? record['steps'].slice(0, MEGAMUD_PATH_LIMITS.steps).map(text).filter(Boolean)
      : [];
    const start = text(record['start']);
    if (start.length === 0 || steps.length === 0) continue;
    const startRow = text(record['startRow']);
    paths.push({
      file: text(record['file']),
      title: text(record['title']),
      area: text(record['area']),
      start,
      startRow: startRow.length > 0 ? startRow : null,
      steps
    });
  }
  return paths;
}

/** The loops a conversion produced, and what it left behind. */
export interface MegaMudConversion {
  loops: Loop[];
  dropped: LoopsDropped;
  /** Loops that share a label with an earlier one and carry a number. */
  numbered: number;
}
