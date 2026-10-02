/** Escape cancels a chat-only turn; it never interrupts builders or closes another surface. */
export function composerEscapeIntent({ runId, turnInFlight }: { runId: string | null; turnInFlight: boolean }): {
  kind: "cancel-turn" | "none";
} {
  return !runId && turnInFlight ? { kind: "cancel-turn" } : { kind: "none" };
}
