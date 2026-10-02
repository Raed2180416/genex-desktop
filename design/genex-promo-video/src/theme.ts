/** The Genex app's dark palette and type, as the promo film draws them. */
export const C = {
  canvas: "#1d1d1f",
  sidebar: "#171719",
  surface: "#242426",
  panel: "#28292a",
  soft: "#2b2c2d",
  hover: "#313234",
  line: "#2a2b2c",
  lineStrong: "#38393b",
  ink: "#dee0e2",
  ink2: "#c9cbce",
  ink3: "#a8a9ac",
  accent: "#88acef",
  accentFill: "#4e6ead",
  green: "#7cd194",
  orange: "#efbe72",
  skyDeep: "#131f55",
  skyMid: "#213a8e",
  skyBlue: "#4674d6",
  skyHaze: "#6e82b8",
  skyWhite: "#eef2ff",
} as const;

export const SANS = '"Zalando Sans SemiExpanded", system-ui, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, monospace';

export const W = 760;
export const H = 400;
export const FPS = 30;
export const FRAMES = 403;

/** A small seeded random, so every render draws the same waveform. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
