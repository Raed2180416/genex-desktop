/** Display-only state. OAuth URLs and credentials stay out of renderer/event history. */
export interface CodexLoginState {
  revision: number;
  visible: boolean;
  phase: "idle" | "starting" | "waiting" | "verifying" | "connected" | "failed" | "cancelled";
  method: "browser" | "device";
  lines: string[];
  hasBrowserUrl: boolean;
  deviceCode?: string;
  error?: string;
}

export function isCodexLoginActive(state: CodexLoginState): boolean {
  return ["starting", "waiting", "verifying"].includes(state.phase);
}
