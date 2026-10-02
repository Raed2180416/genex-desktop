/** One host snapshot for connection setup and session application. No credential values. */
export interface ConnectionSnapshot {
  revision: number;
  appliedRevision: number | null;
  active: boolean;
  sources: Array<{
    id: string;
    name: string;
    kind: "plugin" | "mcp";
    enabled: boolean;
    health: string;
    tools: number;
    pending?: boolean;
    reason?: string;
    account?: "locked" | "authorizing" | "unlocked" | "not connected" | "failed";
  }>;
}
