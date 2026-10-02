/** Small, versioned, data-only interface for a chat agent or local renderer. */
export const SPHERE_BASES = ['planets', 'ribbons', 'crystal', 'eclipse', 'fragments', 'cloud-pearl'];
export const SPHERE_PALETTES = {
  ice: [0.09, 0.43, 0.75], violet: [0.38, 0.20, 0.78], jade: [0.08, 0.56, 0.43],
  amber: [0.79, 0.43, 0.13], rose: [0.73, 0.18, 0.38], silver: [0.51, 0.60, 0.72],
};
export const SPHERE_MIXES = {
  planets: ['none', 'clouds', 'fragments', 'crystal'],
  ribbons: ['none', 'moon', 'crystal', 'fragments'],
  crystal: ['none', 'clouds', 'moon', 'fragments'],
  eclipse: ['none', 'clouds', 'fragments', 'ribbons'],
  fragments: ['none', 'clouds', 'moon', 'ribbons'],
  'cloud-pearl': ['none'],
};
export function validateSphereRecipe(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Recipe must be a JSON object.');
  const keys = new Set(['version', 'seed', 'base', 'mix', 'palette']);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw Error(`Unknown recipe field: ${key}`);
  if (value.version !== 1) throw Error('Recipe version must be 1.');
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) throw Error('Seed must be an unsigned 32-bit integer.');
  if (!SPHERE_BASES.includes(value.base)) throw Error(`Choose a base: ${SPHERE_BASES.join(', ')}.`);
  if (!Object.hasOwn(SPHERE_PALETTES, value.palette)) throw Error('Choose an available palette.');
  const mix = Object.hasOwn(value, 'mix') ? value.mix : 'none';
  if (!SPHERE_MIXES[value.base].includes(mix)) throw Error(`Mix ${mix} is not supported with ${value.base}.`);
  return { version: 1, seed: value.seed, base: value.base, mix, palette: value.palette };
}
export function recipeFromBrief(brief, choices = {}) {
  if (typeof brief !== 'string') throw Error('Brief must be text.');
  const normalized = brief.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!normalized) return { version: 1, seed: 23, base: 'cloud-pearl', mix: 'none', palette: 'ice' };
  let seed = 2166136261;
  for (const char of normalized) seed = Math.imul(seed ^ char.codePointAt(0), 16777619) >>> 0;
  const base = choices.base ?? SPHERE_BASES[seed % 5];
  if (!SPHERE_BASES.includes(base)) throw Error('Unsupported base.');
  const mix = choices.mix ?? SPHERE_MIXES[base][(seed >>> 10) % SPHERE_MIXES[base].length];
  const palette = choices.palette ?? Object.keys(SPHERE_PALETTES)[(seed >>> 17) % 6];
  return validateSphereRecipe({ version: 1, seed, base, mix, palette });
}
export const SPHERE_EXAMPLES = [
  { name: 'Planetary system', recipe: { version: 1, seed: 127, base: 'planets', mix: 'none', palette: 'ice' } },
  { name: 'Liquid ribbons', recipe: { version: 1, seed: 818, base: 'ribbons', mix: 'none', palette: 'rose' } },
  { name: 'Crystal core', recipe: { version: 1, seed: 642, base: 'crystal', mix: 'none', palette: 'violet' } },
  { name: 'Eclipse', recipe: { version: 1, seed: 339, base: 'eclipse', mix: 'none', palette: 'amber' } },
  { name: 'Suspended fragments', recipe: { version: 1, seed: 511, base: 'fragments', mix: 'none', palette: 'jade' } },
  { name: 'Cloud pearl · placeholder', recipe: { version: 1, seed: 23, base: 'cloud-pearl', mix: 'none', palette: 'ice' } },
  { name: 'Planet + crystal', recipe: { version: 1, seed: 928, base: 'planets', mix: 'crystal', palette: 'jade' } },
  { name: 'Ribbons + moon', recipe: { version: 1, seed: 218, base: 'ribbons', mix: 'moon', palette: 'ice' } },
  { name: 'Crystal + clouds', recipe: { version: 1, seed: 177, base: 'crystal', mix: 'clouds', palette: 'rose' } },
  { name: 'Eclipse + fragments', recipe: { version: 1, seed: 429, base: 'eclipse', mix: 'fragments', palette: 'violet' } },
  { name: 'Fragments + ribbons', recipe: { version: 1, seed: 917, base: 'fragments', mix: 'ribbons', palette: 'amber' } },
];
