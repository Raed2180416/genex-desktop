/**
 * The composer's two ways to stop: its Stop button and Escape. Both interrupt the selected chat's
 * own turn through `cancelTurn`; neither ever stops a build (tests/conformance/run-controls.test.ts).
 */
import { composerEscapeIntent } from "./stopping.ts";

/** Composer Stop: this conversation's turn, now. A failed request is the caller's to report. */
export function stopTurn(
  api: { cancelTurn(threadId: string): Promise<unknown> },
  threadId: string,
  onFailed: (err: unknown) => void,
): void {
  void api.cancelTurn(threadId).catch(onFailed);
}

/**
 * The chat an Escape press cancels, or null. Escape belongs to the composer and to nothing else:
 * a press elsewhere is for whatever has focus, and during a build there is nothing for it to do.
 */
export function escapeCancels(
  event: { key: string; target: unknown },
  state: { threadId: string | null; runId: string | null; turnInFlight: boolean },
): string | null {
  if (event.key !== "Escape" || !state.threadId) return null;
  if (!(event.target as { closest?: (selector: string) => unknown } | null)?.closest?.("[data-promptbar]")) return null;
  return composerEscapeIntent({ runId: state.runId, turnInFlight: state.turnInFlight }).kind === "cancel-turn"
    ? state.threadId
    : null;
}
