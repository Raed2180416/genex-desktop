/**
 * What a builder is told when its session hands over to a fresh one (phases/handover.ts): the
 * last turn of the old session, and the line that opens the new one.
 */

/** The notes section a handover is written under, and the one the fresh session is sent to read. */
export const HANDOVER_HEADING = "## Handover";

/** The handover turn, sent in the session that remembers the round: written into its own notes file. */
export function handoverAsk(notesFile: string): string {
  return [
    `HANDOVER: your next round starts in a new session that remembers nothing of this one.`,
    `Write a handover for it in ${notesFile}, under a \`${HANDOVER_HEADING}\` heading that replaces any earlier one: what you tried, what worked, what failed and why, the open problems, and the files that matter. At most about 40 lines.`,
    `Change no game code in this turn.`,
  ].join("\n");
}

/** The fresh session's pointer at the handover the session before it wrote. */
export function handoverPointer(notesFile: string): string {
  return `HANDOVER: you continue this facet from a session that ended to start fresh. Read the \`${HANDOVER_HEADING}\` section of ${notesFile} before you change anything — it is what that session tried, what worked, what failed, and what is open.`;
}
