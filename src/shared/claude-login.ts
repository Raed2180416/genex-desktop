/**
 * Display-only state for the Claude sign-in. The authorize URL carries the PKCE challenge and the
 * session state, so it stays in main: the card can ask for it to be opened, never read it.
 */
export interface ClaudeLoginState {
  revision: number;
  /**
   * `browser` — the sign-in page is open and we are waiting; `code` — Claude Code is waiting for
   * the code the browser shows; `terminal` — the sign-in is using Studio's embedded PTY.
   */
  phase: "idle" | "starting" | "browser" | "code" | "verifying" | "connected" | "failed" | "cancelled" | "terminal";
  /** Main is holding a sign-in link the card can ask it to open again. */
  hasBrowserUrl: boolean;
  error?: string;
}

export function isClaudeLoginActive(state: ClaudeLoginState): boolean {
  return ["starting", "browser", "code", "verifying", "terminal"].includes(state.phase);
}
