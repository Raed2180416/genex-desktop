/** What the model reads when it names a game started from its first request (`game-naming.ts`). Model-facing. */

/** The instruction for the one tool-free completion that names a new game. */
export const GAME_NAME_SYSTEM_PROMPT =
  "You name video games. Read the request for a game and reply with a short, memorable title for it: two to four words, in the request's language. Reply with the title only: no quotes, no punctuation at the end, no explanation, no questions.";

/** The one user message a game is named from. */
export function gameNameRequest(request: string): string {
  return `Request for a game:\n${request}`;
}
