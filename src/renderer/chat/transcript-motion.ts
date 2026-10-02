import { OPEN_MS } from "../ui/motion.ts";

/** Only appended content enters; initial history and prepended pages stay still. */
export function appendedEntryIds(previous: readonly string[] | null, next: readonly string[]): Set<string> {
  if (!previous) return new Set();
  const known = new Set(previous);
  const tail = next.findLastIndex((id) => known.has(id));
  return new Set(next.slice(tail + 1).filter((id) => !known.has(id)));
}

/**
 * How far into its opening a row starts, in ms: a saved message takes over from its placeholder
 * mid-opening (`startedAt`, when the placeholder began) and carries on from there, so it neither
 * jumps to full size nor starts over. Null once that opening has finished, or when there was none.
 */
export function continuedEntrance(startedAt: number | undefined, now: number): number | null {
  if (startedAt === undefined) return null;
  const elapsed = Math.max(0, now - startedAt);
  return elapsed < OPEN_MS ? elapsed : null;
}
