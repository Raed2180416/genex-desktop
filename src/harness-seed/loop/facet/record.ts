/** What the facet loop writes on the run's record: the fields its round events share, and its decision cards. */
import { RunEvent } from "../run-events.ts";
import type { AnyRecord } from "../../types/harness.d.ts";
import type { FacetLoopState } from "./state.ts";

/** Where in a round a provider outage was waited out (`facet_provider_outage.phase`). */
export const OutagePhase = {
  Build: "build",
  Verify: "verify",
} as const;
export type OutagePhase = (typeof OutagePhase)[keyof typeof OutagePhase];

/** The fields every event about one of this facet's rounds starts with. */
export function roundFields(loop: Pick<FacetLoopState, "run" | "facet">, iteration: number) {
  return { runId: loop.run.runId, facetId: loop.facet.id, iteration };
}

/** One decision card on the run's feed (`autopilot_decision`), stamped now. */
export function recordDecision(loop: Pick<FacetLoopState, "run" | "appendRun">, decision: string): Promise<unknown> {
  return loop.appendRun(RunEvent.AutopilotDecision, {
    runId: loop.run.runId,
    decision,
    at: new Date().toISOString(),
  });
}

/** The move a round carried, as its record names it before anybody has judged whether it landed. */
export function unjudgedMove(move: AnyRecord | null): AnyRecord | null {
  if (!move?.what) return null;
  return {
    what: move.what,
    milestoneId: move.milestoneId,
    source: move.source,
    mandatory: move.mandatory === true,
    delivered: null,
    scale: null,
  };
}
