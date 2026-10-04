/**
 * A chat's compactions as its log records them: the `compacted` event a summary or a session's
 * handover writes (compact.ts, session-compact.ts), and what a later turn reads back from it.
 */
import { HostMethod } from "./host-methods.ts";
import { EventKind, RunEvent } from "./run-events.ts";
import type { AnyRecord, HarnessCtx } from "../types/harness.d.ts";

/** The session phase the chat shows while a compaction runs (`session_activity`). */
export const COMPACTING_PHASE = "compacting";

/** Append one custom event to the chat's log. */
export async function appendCustom(
  ctx: HarnessCtx,
  threadId: string,
  eventType: string,
  payload: AnyRecord,
): Promise<void> {
  await ctx.call(HostMethod.EventsAppend, {
    threadId,
    batch: [{ type: EventKind.Custom, event_type: eventType, payload }],
  });
}

/** The chat's latest `compacted` event, with its id and payload; null when it never compacted. */
export function latestCompaction(
  events: readonly AnyRecord[] | undefined,
): { id?: string; payload?: AnyRecord } | null {
  for (const event of [...(events ?? [])].reverse()) {
    const data = event?.data ?? event;
    if (data?.type === EventKind.Custom && data.event_type === RunEvent.Compacted)
      return { id: event?.id, payload: data.payload };
  }
  return null;
}

/** The handover the chat's latest compaction wrote, for a fresh session's brief; null when there is none. */
export function compactedSummary(events: readonly AnyRecord[] | undefined): string | null {
  const summary = latestCompaction(events)?.payload?.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

/**
 * Did a compaction end this session? Each one names the session it ended, and a message sent
 * before it landed still carries that session to resume.
 */
export function endedByCompaction(
  events: readonly AnyRecord[] | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  return (events ?? []).some((event) => {
    const data = event?.data ?? event;
    const compaction = data?.type === EventKind.Custom && data.event_type === RunEvent.Compacted;
    return compaction && data.payload?.sessionId === sessionId;
  });
}
