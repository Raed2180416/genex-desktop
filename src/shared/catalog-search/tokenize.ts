/**
 * PURE tokenizer shared by index time and query time (ported verbatim from the
 * docs-search engine). Identical tokenization on both sides guarantees term
 * alignment: query.ts calls this same function on the user's raw input.
 *
 * Lowercase, split on non-alphanumerics, and additionally split
 * camelCase/acronym/digit boundaries so `"SceneApi"` yields the whole token
 * `sceneapi` plus its parts `scene`, `api`. Tokens shorter than two characters
 * are dropped; the result is de-duped preserving first-seen order.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  const out: string[] = [];

  // (a) Coarse split the ORIGINAL text on any run of non-letter/non-number.
  const chunks = text.split(/[^\p{L}\p{N}]+/u);

  for (const chunk of chunks) {
    if (!chunk) continue;

    // (b) Whole chunk lowercased FIRST: `SceneApi` -> `sceneapi`.
    out.push(chunk.toLowerCase());

    // Sub-split on camelCase / acronym / digit boundaries (original case).
    const spaced = chunk
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2");

    for (const part of spaced.split(/\s+/)) {
      if (part) out.push(part.toLowerCase());
    }
  }

  // Drop tokens shorter than 2 chars; dedupe preserving first-seen order.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of out) {
    if (token.length < 2) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}
