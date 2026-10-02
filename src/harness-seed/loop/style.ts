/**
 * Resemblance as a number — HARNESS-FIX-PLAN.md WP4.
 *
 * Nothing in the loop measured "looks like the stills" before this: the checks counted meshes
 * and luma bands, the judges answered yes/no on crops, and a run declared victory over
 * Morrowind with untextured boxes. `styleDistance` is the deterministic gate: the same stats
 * the pixel checks read (histogram, hue histogram, Lab palette, saturation, contrast, row
 * profile) compared between a build frame and a reference still, 0 (identical) to 1.
 *
 * Pure arithmetic over `PixelStats` JSON, so it runs in the harness child (which has no
 * Electron) and in the conformance suite under plain node. The stats themselves are computed
 * where captures happen (`substrate/pixel-stats.ts`).
 */
import { hasOwnStyle } from "./cameras.ts";
import type { PixelStats } from "../types/host-api.d.ts";

/** The parts of a frame's `PixelStats` a style distance reads; any may be missing (older stats). */
export type StyleStats = Pick<
  PixelStats,
  "histogram" | "hueHistogram" | "palette" | "saturation" | "contrast" | "lumaProfile"
>;

/** A palette entry: a Lab centroid and its share of the frame. */
export interface PaletteEntry {
  lab: readonly number[];
  weight?: number;
}

/** How the six components add up; a component missing on either side gives its weight to the rest. */
export const STYLE_WEIGHTS: Record<string, number> = {
  luma: 0.25,
  hue: 0.2,
  palette: 0.3,
  saturation: 0.1,
  contrast: 0.05,
  profile: 0.1,
};

/** One-dimensional Wasserstein-1 between two normalised histograms, in bins, over bins-1 → 0–1. */
export function histogramDistance(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined,
): number | null {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || a.length !== b.length) return null;
  const sumA = a.reduce((s, v) => s + v, 0);
  const sumB = b.reduce((s, v) => s + v, 0);
  if (!(sumA > 0) || !(sumB > 0)) return null;
  let cumulative = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    cumulative += a[i]! / sumA - b[i]! / sumB;
    total += Math.abs(cumulative);
  }
  return Math.min(1, total / Math.max(1, a.length - 1));
}

/**
 * Circular Wasserstein-1 for a hue histogram: the cheapest rotation of mass around the wheel,
 * normalised by half a turn. Null when either side has no saturated pixels — a grey frame has
 * no hue to compare, and the saturation component carries that difference instead.
 */
export function circularHistogramDistance(
  a: readonly number[] | null | undefined,
  b: readonly number[] | null | undefined,
): number | null {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || a.length !== b.length) return null;
  const sumA = a.reduce((s, v) => s + v, 0);
  const sumB = b.reduce((s, v) => s + v, 0);
  if (!(sumA > 0) || !(sumB > 0)) return null;
  const n = a.length;
  const cumulative: number[] = [];
  let running = 0;
  for (let i = 0; i < n; i++) {
    running += a[i]! / sumA - b[i]! / sumB;
    cumulative.push(running);
  }
  // Circular EMD = Σ |D_i − median(D)| (Rabin, Delon & Gousseau).
  const sorted = [...cumulative].sort((x, y) => x - y);
  const median = sorted[Math.floor(n / 2)]!;
  const total = cumulative.reduce((s, d) => s + Math.abs(d - median), 0);
  return Math.min(1, total / (n / 2));
}

function labDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/**
 * Palette matching cost: the best one-to-one pairing of the two palettes (≤ 6 entries → at
 * most 720 permutations, brute force is exact and cheap), each pair weighted by the mean of
 * the two weights and scaled by 100 Lab units. 0 when the palettes coincide, ~1 when every
 * dominant colour sits a hundred Lab units from its partner.
 */
export function paletteDistance(
  a: readonly PaletteEntry[] | null | undefined,
  b: readonly PaletteEntry[] | null | undefined,
): number | null {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || b.length === 0) return null;
  const size = Math.max(a.length, b.length);
  const pad = (list: readonly PaletteEntry[]): PaletteEntry[] =>
    Array.from({ length: size }, (_, i) => list[Math.min(i, list.length - 1)]!);
  const pa = pad(a);
  const pb = pad(b);
  const wa = pa.map((e) => e.weight ?? 1 / size);
  const wb = pb.map((e) => e.weight ?? 1 / size);
  let best = Infinity;
  const used: boolean[] = new Array(size).fill(false);
  const order: number[] = [];
  const walk = (i: number, cost: number): void => {
    if (cost >= best) return;
    if (i === size) {
      best = cost;
      return;
    }
    for (let j = 0; j < size; j++) {
      if (used[j]) continue;
      used[j] = true;
      order.push(j);
      walk(i + 1, cost + ((wa[i]! + wb[j]!) / 2) * labDistance(pa[i]!.lab, pb[j]!.lab));
      order.pop();
      used[j] = false;
    }
  };
  walk(0, 0);
  return Math.min(1, best / 100);
}

/**
 * The style distance between two `PixelStats`, 0–1. Symmetric; 0 for identical stats.
 * Returns null only when neither side carries any of the six components (legacy stats).
 */
export function styleDistance(a: StyleStats | null | undefined, b: StyleStats | null | undefined): number | null {
  if (!a || !b) return null;
  const parts: Array<{ key: string; value: number; weight: number }> = [];
  const push = (key: string, value: number | null): void => {
    if (typeof value === "number" && Number.isFinite(value))
      parts.push({ key, value: Math.max(0, Math.min(1, value)), weight: STYLE_WEIGHTS[key]! });
  };
  push("luma", histogramDistance(a.histogram, b.histogram));
  push("hue", circularHistogramDistance(a.hueHistogram, b.hueHistogram));
  push("palette", paletteDistance(a.palette, b.palette));
  if (typeof a.saturation === "number" && typeof b.saturation === "number")
    push("saturation", Math.abs(a.saturation - b.saturation));
  if (typeof a.contrast === "number" && typeof b.contrast === "number")
    push("contrast", Math.abs(a.contrast - b.contrast) / 255);
  const lumaA = a.lumaProfile;
  const lumaB = b.lumaProfile;
  const sameProfile = Array.isArray(lumaA) && Array.isArray(lumaB) && lumaA.length === lumaB.length && lumaA.length > 0;
  if (sameProfile) {
    const l1 = lumaA.reduce((s, v, i) => s + Math.abs(v - Number(lumaB[i])), 0) / lumaA.length;
    push("profile", l1 / 255);
  }
  const weight = parts.reduce((s, p) => s + p.weight, 0);
  if (weight <= 0) return null;
  return parts.reduce((s, p) => s + p.value * p.weight, 0) / weight;
}

/** The per-component breakdown, for a brief that wants to say *what* is far. */
export function styleBreakdown(
  a: StyleStats | null | undefined,
  b: StyleStats | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  const luma = histogramDistance(a?.histogram, b?.histogram);
  const hue = circularHistogramDistance(a?.hueHistogram, b?.hueHistogram);
  const palette = paletteDistance(a?.palette, b?.palette);
  if (luma !== null) out.luma = luma;
  if (hue !== null) out.hue = hue;
  if (palette !== null) out.palette = palette;
  if (typeof a?.saturation === "number" && typeof b?.saturation === "number")
    out.saturation = Math.abs(a.saturation - b.saturation);
  if (typeof a?.contrast === "number" && typeof b?.contrast === "number")
    out.contrast = Math.abs(a.contrast - b.contrast) / 255;
  return out;
}

/**
 * The reference still a frame is closest to. `refs` are `{ label, stats }`; a still without
 * stats is skipped. Null when nothing is comparable.
 */
export function nearestReference(
  stats: StyleStats | null | undefined,
  refs: ReadonlyArray<{ label?: string; stats?: StyleStats | null } | null | undefined> | null | undefined,
): { label: string; index: number; distance: number } | null {
  let best: { label: string; index: number; distance: number } | null = null;
  for (const [index, ref] of (refs ?? []).entries()) {
    const distance = styleDistance(stats, ref?.stats);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { label: ref!.label ?? String(index + 1), index, distance };
  }
  return best;
}

/**
 * The best (lowest) style distance across a set of shots against a set of references —
 * the number the exit condition compares to the run's floor (WP7).
 */
export function bestStyleDistance(
  shots: ReadonlyArray<{ camera?: string; stats?: StyleStats | null } | null | undefined> | null | undefined,
  refs: Parameters<typeof nearestReference>[1],
): { camera: string | undefined; distance: number; reference: string } | null {
  let best: { camera: string | undefined; distance: number; reference: string } | null = null;
  for (const shot of shots ?? []) {
    if (!shot?.stats || !hasOwnStyle(shot)) continue;
    const near = nearestReference(shot.stats, refs);
    if (!near) continue;
    if (!best || near.distance < best.distance)
      best = { camera: shot.camera, distance: near.distance, reference: near.label };
  }
  return best;
}
