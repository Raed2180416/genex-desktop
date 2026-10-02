import { CustomEvent, DELEGATED_PREFIX } from "./custom-events.ts";
import { EventKind, type EventEnvelope } from "./event-log.ts";

/** Graph-only transport offsets preserve chronology when bulky trace events are omitted. */
export type RunGraphEvent = EventEnvelope & { graphSequence?: number; graphLastAt?: string };

/** Remove non-drawing traces while preserving the original custom-event positions and last timestamp. */
export function compactGraphEvents(events: EventEnvelope[]): RunGraphEvent[] {
  const compact: RunGraphEvent[] = [];
  let sequence = 0;
  let lastAt: string | undefined;
  for (const event of events) {
    if (event.data.type !== EventKind.Custom) continue;
    sequence++;
    lastAt = event.created_at;
    const kind = event.data.event_type;
    const noise =
      kind.startsWith(DELEGATED_PREFIX) || kind === CustomEvent.SessionActivity || kind === CustomEvent.ContextUsage;
    if (!noise) compact.push({ ...event, graphSequence: sequence });
  }
  const last = compact.at(-1);
  if (last && lastAt !== undefined) last.graphLastAt = lastAt;
  return compact;
}
