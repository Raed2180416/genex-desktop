/** Where a recorded tool call stands; the value is also its row's data-tool-state. */
export const ToolState = {
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
  Stopped: "stopped",
  /** A call whose ending was never recorded. */
  Unknown: "unknown",
} as const;
export type ToolState = (typeof ToolState)[keyof typeof ToolState];

/** The call failed: flagged so, or recorded as failed. */
export const toolFailed = (row: { failed?: boolean; state?: ToolState }): boolean =>
  Boolean(row.failed) || row.state === ToolState.Failed;

/** How a line of a tool's output is marked: an added line, a removed one, or an error. */
export const OutputTone = { Add: "add", Del: "del", Err: "err" } as const;
export type OutputTone = (typeof OutputTone)[keyof typeof OutputTone];
