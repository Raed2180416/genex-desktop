import { followsTail, mergeChatEvents } from "../shared/chat-history.ts";
/** App's copy of the all-threads log: when a refresh may read, and how a read is merged. */
import type { EventEnvelope } from "./types.ts";

/** The renderer keeps at most this many recent events across all threads. */
export const FEED_WINDOW = 4000;

/** What one refresh request does: see `eventRefreshAction`. */
export const EventRefreshAction = {
  Defer: "defer",
  Fetch: "fetch",
  Queue: "queue",
} as const;
export type EventRefreshAction = (typeof EventRefreshAction)[keyof typeof EventRefreshAction];

/**
 * One refresh request: read now, queue one follow-up behind the read in flight, or — before the
 * bootstrap has set the cursor — defer until it has. A read with no cursor lists every thread's
 * whole log, so a poll or notification that beat the bootstrap was an unbounded read.
 */
export function eventRefreshAction(state: { bootstrapped: boolean; inFlight: boolean }): EventRefreshAction {
  if (!state.bootstrapped) return EventRefreshAction.Defer;
  return state.inFlight ? EventRefreshAction.Queue : EventRefreshAction.Fetch;
}

/** Append a read to the window: ids already held are dropped, the newest `FEED_WINDOW` kept. */
export function appendFeed(current: EventEnvelope[], fresh: readonly EventEnvelope[]): EventEnvelope[] {
  if (fresh.length === 0) return current;
  if (followsTail(current, fresh)) return [...current, ...fresh].slice(-FEED_WINDOW);
  const merged = mergeChatEvents(current, fresh);
  if (merged.length === current.length && merged.every((event, index) => event.id === current[index]?.id))
    return current;
  return merged.slice(-FEED_WINDOW);
}
