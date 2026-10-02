/** Candidate mapping for discussion, deliberately separate from the production cover code. */
export function sphereIdentityFromPrompt(prompt) {
  const text = prompt.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  let seed = 2166136261;
  for (const character of text) seed = Math.imul(seed ^ character.codePointAt(0), 16777619) >>> 0;
  // The text hash chooses a palette. A local PRNG chooses the finer material details.
  // These are stable identity marks; colors do not classify or depict game genres.
  let state = seed;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const palettes = [
    { name: 'Glacier', color: [.035, .43, .64] },
    { name: 'Cobalt', color: [.035, .21, .69] },
    { name: 'Violet', color: [.31, .10, .65] },
    { name: 'Jade', color: [.035, .40, .28] },
    { name: 'Amber', color: [.63, .31, .055] },
    { name: 'Rose', color: [.60, .08, .29] },
  ];
  const palette = palettes[seed % palettes.length];
  return { seed, palette: palette.name, color: palette.color, detail: .22 + next() * .60, turn: next() * Math.PI * 2, gloss: .7 };
}
