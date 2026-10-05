/**
 * A chat's compactions as its log records them: the `compacted` event a summary, a session's
 * handover or the provider's own compaction writes (compact.ts, session-compact.ts), and what a
 * later turn reads back from it.
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

/**
 * The latest summary a compaction wrote, for a fresh session's brief; null when there is none. A
 * Codex compaction writes none (it keeps its own sealed in its session), so the one before it stands.
 */
export function compactedSummary(events: readonly AnyRecord[] | undefined): string | null {
  for (const event of [...(events ?? [])].reverse()) {
    const data = event?.data ?? event;
    if (data?.type !== EventKind.Custom || data.event_type !== RunEvent.Compacted) continue;
    const summary = data.payload?.summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  return null;
}

/**
 * Does this record end the chat's provider sessions? A handover or a log summary does: the next
 * turn starts fresh, briefed with it. The provider's own compaction (`native`) does not: it
 * compacted the session in place, and the next turn resumes it. The app's copy is
 * shared/chat-rewind.ts `endsChatSessions`.
 */
export function endsSessions(data: AnyRecord | undefined): boolean {
  return data?.type === EventKind.Custom && data.event_type === RunEvent.Compacted && data.payload?.native !== true;
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
    return endsSessions(data) && data.payload?.sessionId === sessionId;
  });
}
