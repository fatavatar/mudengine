/**
 * The realm's word for "where am I standing" (todo 811): a closed list,
 * stated per realm (`server.yaml` `locate:`) and overridable per character
 * (`profile.yaml` `locate:`), resolved in `resolveProfile` the way the login
 * script is. `none` is a realm that has no such word, where the client asks
 * nothing. `sys-status` is the MajorMUD lineage's, for a realm with no `rm`
 * at all (`bbs.thelucks.org`, WorldGroup, captured live 2026-09-21): its first
 * line, `Room <n>  Map: <n>`, is read as `user-location`. See
 * `mudengine-config` › *A realm's own word for where am I*.
 *
 * Dependency-free, like the rest of `src/shared`.
 */

export const LOCATE_WORDS = ['rm', 'sys-status', 'none'] as const;
export type LocateWord = (typeof LOCATE_WORDS)[number];

/** What a realm that states nothing uses: `rm`, what every realm was asked before. */
export const DEFAULT_LOCATE: LocateWord = 'rm';

/** A locate word off disk or off the wire, or null for anything this client does not know. */
export function asLocateWord(value: unknown): LocateWord | null {
  return typeof value === 'string' && (LOCATE_WORDS as readonly string[]).includes(value)
    ? (value as LocateWord)
    : null;
}

/** The command a locate word sends, or null where the realm has none. */
export function locateCommand(word: LocateWord): string | null {
  switch (word) {
    case 'rm':
      return 'rm';
    case 'sys-status':
      return 'sys status';
    case 'none':
      return null;
    default: {
      const unreachable: never = word;
      return unreachable;
    }
  }
}
