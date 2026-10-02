/** How a round's phase answers the loop, and the one way a phase ends it when the user stopped the run. */
import { EngineFailure } from "../outage.ts";
import { StopCode, stopWith } from "../outcomes.ts";
import type { HarnessCtx } from "../../types/harness.d.ts";
import type { FacetLoopState } from "./state.ts";

/**
 * A phase's answer: end the loop, or go on to the next round now. The facet loop's rounds and the
 * classic run's iterations both answer with it.
 */
export const RoundFlow = {
  Stop: "stop",
  Next: "next",
} as const;
/** What a phase answers: a flow, or nothing to hand on to the next phase. */
export type RoundFlow = (typeof RoundFlow)[keyof typeof RoundFlow] | null | undefined | void;

/** Did a call fail because the run was stopped: an aborted engine call, or a cancelled run? */
export function isStopped(err: unknown, ctx: HarnessCtx): boolean {
  return (err as { kind?: unknown } | null)?.kind === EngineFailure.Aborted || Boolean(ctx.cancelled);
}

/** The user stopped the run: the facet's loop ends here, and its record says so. */
export function stoppedByUser(loop: Pick<FacetLoopState, "result">): RoundFlow {
  stopWith(loop.result, StopCode.UserStop, "stopped by the user");
  return RoundFlow.Stop;
}
