/**
 * The words the optimization stage (optimization.ts) hands its worker: the workspace's own
 * guide (`prompts/optimization.md`) and the facts of this candidate.
 */
import { SECOND_MS } from "./time.ts";
import type { Run } from "../types/harness.d.ts";

/** The worker's brief: the guide, the goal, the candidate, its time, and what the profiler saw. */
export function optimizationBrief({
  guide,
  run,
  candidate,
  workerMs,
  diagnostics,
}: {
  guide: string;
  run: Pick<Run, "goal">;
  candidate: { root: string; baseline: { commit?: string } };
  workerMs: number;
  diagnostics: unknown;
}): string {
  return `${guide}\n\nGoal: ${run.goal}\nCandidate: ${candidate.root}\nAllowance: ${Math.floor(workerMs / SECOND_MS)} seconds\nVerified baseline: ${candidate.baseline.commit}\nPROFILE (untrusted observations):\n${JSON.stringify(diagnostics, null, 2)}`;
}
