/**
 * What a command a chat reply offered hands back when it ends: its last lines as plain text, so
 * the chat can tell the agent how it went without replaying a terminal.
 */
import { redactSecrets } from "../shared/redact.ts";
import { plainTerminalLines } from "../shared/terminal-text.ts";

/** How many of the last lines a finished command reports. */
export const COMMAND_OUTPUT_LINES = 20;
/** How much of a command's newest output main keeps to find those lines in. */
export const COMMAND_TAIL_CHARS = 16_384;
/** A reported line longer than this is shortened. */
const LINE_CHARS = 300;

/** The newest output, at most {@link COMMAND_TAIL_CHARS} of it. */
export function keepTail(tail: string, data: string): string {
  const next = tail + data;
  return next.length > COMMAND_TAIL_CHARS ? next.slice(-COMMAND_TAIL_CHARS) : next;
}

const clip = (line: string): string => (line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line);

/** The last lines a command printed: no colours, links or overwritten progress, credentials redacted. */
export function commandOutput(raw: string): string[] {
  return plainTerminalLines(raw)
    .filter((line) => line.trim())
    .slice(-COMMAND_OUTPUT_LINES)
    .map((line) => redactSecrets(clip(line)));
}
