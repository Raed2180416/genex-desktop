import type { RunSpec } from "../types/host-api.d.ts";

/** Runtime intent is independent of the kind of visual reference. */
export const CompletionPolicy = {
  Goal: "goal",
  Duration: "duration",
} as const satisfies Record<string, NonNullable<RunSpec["budgets"]["completionPolicy"]>>;
