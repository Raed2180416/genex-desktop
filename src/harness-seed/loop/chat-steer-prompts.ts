/**
 * The words a steered chat session is given (chat-steer.ts): the person's messages sent while it
 * worked, quoted in front of it, in the order they were sent.
 */

/** Each message as a quote block, so the session reads it as the person's own words. */
function quoted(texts: readonly string[]): string[] {
  return texts.map((text) => `> ${String(text).trim().replace(/\n/g, "\n> ")}`);
}

/**
 * What an interrupted chat session is resumed with. Its turn was cut short only to hand it the
 * person's words, so it keeps what it did and goes on with them in front — never a fresh start.
 */
export function steeredTurnPrompt(texts: readonly string[]): string {
  return [
    "The user sent a new message while you were working — your turn was interrupted to hand it to you:",
    ...quoted(texts),
    "",
    "Address it as you continue this turn. Do not start over, and undo nothing you have already done unless it asks you to.",
  ].join("\n");
}

/** A first prompt that also carries what the person sent while it was being written. */
export function withSteers(prompt: string, texts: readonly string[]): string {
  if (!texts.length) return prompt;
  return [
    prompt,
    "",
    "The user also sent this while you were working on the message above — address it too:",
    ...quoted(texts),
  ].join("\n");
}
