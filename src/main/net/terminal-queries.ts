/**
 * The server's questions to the terminal, answered by the session.
 *
 * The BBS asks where the cursor is (`ESC[6n`) at every login and decides from
 * whether it is answered that the caller has ANSI: unanswered, the realm sends
 * plain text for the whole visit (2026-09-24). A page's console used to answer,
 * which was once per open page and never with none open; the consoles now
 * decline (`declineQueries` in the renderer) and the socket's owner answers,
 * beside the Telnet replies it already makes.
 *
 * Only the cursor and the status report. Nothing else is asked by any realm
 * this client dials, and an answer to an unasked question is typing.
 */

/** A device status request: `5` is "are you well", `6` is "where is the cursor". */
const STATUS_REQUEST = /\x1B\[([56])n/g;
/** What takes no column: an escape sequence of any kind. */
const ESCAPES = /\x1B(?:\[[0-9;?]*[\x40-\x7E]|\][^\x07\x1B]*(?:\x07|\x1B\\)|.)/g;

/** Where the cursor stands after `text`, starting from `column` (0-based). */
export function columnAfter(column: number, text: string): number {
  const lineStart = Math.max(text.lastIndexOf('\r'), text.lastIndexOf('\n'));
  let at = lineStart === -1 ? column : 0;
  for (const char of text.slice(lineStart + 1).replace(ESCAPES, '')) {
    if (char === '\b') at = Math.max(0, at - 1);
    else if (char >= ' ') at += 1;
  }
  return at;
}

/**
 * The answers `text` asks for, and the column the cursor ends at.
 *
 * The row is the last one: after a login banner a terminal stands at its
 * foot, and no realm asks in order to learn the row.
 */
export function answerQueries(
  text: string,
  column: number,
  rows: number
): { replies: string[]; column: number } {
  const replies: string[] = [];
  let from = 0;
  let at = column;
  for (const match of text.matchAll(STATUS_REQUEST)) {
    at = columnAfter(at, text.slice(from, match.index));
    from = match.index + match[0].length;
    replies.push(match[1] === '5' ? '\x1B[0n' : `\x1B[${rows};${at + 1}R`);
  }
  return { replies, column: columnAfter(at, text.slice(from)) };
}
