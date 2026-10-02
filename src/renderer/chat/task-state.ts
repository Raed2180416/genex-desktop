/**
 * A build task's state as the run summary records it (`RunTask.state`, `RunAttempt.state`). The
 * summary keeps it a string written by the harness; these are the values the chat reads.
 */
export const TaskState = {
  Running: "running",
  Done: "done",
  Queued: "queued",
  Failed: "failed",
  Stopped: "stopped",
  Superseded: "superseded",
  /** A task that says it runs while its run does not. */
  Unknown: "unknown",
} as const;
export type TaskState = (typeof TaskState)[keyof typeof TaskState];
