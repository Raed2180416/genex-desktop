/**
 * Opening one build's graph from anywhere. The chat's result card for a build names its run; the
 * stage shows that run on Builds, and its status line offers the way back to the latest one.
 */
export const OPEN_BUILD_EVENT = "studio:open-build";

export function openBuildGraph(runId: string): void {
  window.dispatchEvent(new CustomEvent<{ runId: string }>(OPEN_BUILD_EVENT, { detail: { runId } }));
}
