/**
 * How much of the conversation a fresh session's brief quotes verbatim (chat-session.ts
 * `buildContractorBrief`), and so how much of it a switch of model can carry without a written
 * summary (chat-continuity.ts).
 */

/** The latest messages the brief quotes. */
export const TRANSCRIPT_MESSAGES = 20;
/** The most of them it quotes, in characters, counted from the end. */
export const TRANSCRIPT_CHARS = 18_000;
