import { CustomEvent, DELEGATED_PREFIX } from "../../shared/custom-events.ts";
import { EngineId } from "../../shared/providers.ts";
import { EventKind, type EventEnvelope, type ConversationRecord } from "../../shared/event-log.ts";

/** Synthetic thousand-step run with five independent worker logs, without files or provider calls. */
export function largeBuildGraph() {
  const runId = "performance-run";
  const threads: ConversationRecord[] = Array.from({ length: 5 }, (_, index) => ({
    id: `worker-${index}`,
    agent_id: "studio",
    created_at: "",
    updated_at: "",
    latest_event_id: null,
    title: `${runId} · Part ${index}`,
  }));
  const events: EventEnvelope[] = [];
  const push = (type: string, payload: Record<string, unknown>, threadId = "lead") => {
    events.push({
      id: String(events.length).padStart(8, "0"),
      thread_id: threadId,
      session_id: null,
      turn_id: null,
      created_at: new Date(1_800_000_000_000 + events.length).toISOString(),
      data: { type: EventKind.Custom, event_type: type, payload: { runId, ...payload } },
    });
  };
  push(CustomEvent.RunStarted, { goal: "A large synthetic build" });
  push(CustomEvent.AutopilotStarted, {
    facets: threads.map((_, index) => ({ id: `part-${index}`, title: `Part ${index}`, budgetShare: 0.2 })),
    maxParallel: 5,
  });
  for (let index = 0; index < 1_000; index++) {
    const part = index % 5;
    const iteration = Math.floor(index / 5) + 1;
    const facet = { facetId: `part-${part}`, facetTitle: `Part ${part}`, iteration };
    push(CustomEvent.FacetMove, { ...facet, what: `Step ${index}`, milestoneId: `step-${index}`, source: "milestone" });
    push(CustomEvent.FacetBuildStarted, facet);
    push(CustomEvent.FacetIteration, { ...facet, winner: "challenger", satisfied: false });
    push(`${DELEGATED_PREFIX}${EngineId.Codex}`, {}, `worker-${part}`);
  }
  return { events, threads, runId };
}
