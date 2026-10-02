/**
 * The picture as ink: for each sample of the picture, how much ink its spot of the drawing wants,
 * 0 (none) to 1 (solid). Pure, so every effect reads the same prepared picture.
 */

/** The image preparation a field applies (`BackdropSettings`' tone fields). */
export interface ToneSettings {
  grain: number;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
}

/** Ink per sample, row by row. */
export interface CoverageField {
  width: number;
  height: number;
  values: Float32Array;
}

/** Where a `width`×`height` picture is cut to cover a frame of `frameWidth`×`frameHeight`, centered. */
export function coverCrop(
  width: number,
  height: number,
  frameWidth: number,
  frameHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const frame = frameWidth / frameHeight;
  if (width / height > frame) {
    const sw = height * frame;
    return { sx: (width - sw) / 2, sy: 0, sw, sh: height };
  }
  const sh = width / frame;
  return { sx: 0, sy: (height - sh) / 2, sw: width, sh };
}

/** A stable noise value in [0, 1) for a sample: grain that does not shimmer between drawings. */
export function grainAt(index: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The field of an RGBA picture (unpremultiplied, as `getImageData` gives it). Ink follows the dark
 * of the picture on a light page and its light on a dark one, so the picture reads the same way.
 */
export function coverageField(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  tone: ToneSettings,
  inkIsLight: boolean,
): CoverageField {
  const values = new Float32Array(width * height);
  const span = Math.max(1, tone.whitePoint - tone.blackPoint);
  const exponent = 1 / tone.gamma;
  for (let index = 0; index < values.length; index++) {
    const at = index * 4;
    // Rec. 709 weights in 256ths, so a grey keeps its exact level.
    const luminance = (54 * (rgba[at] ?? 0) + 183 * (rgba[at + 1] ?? 0) + 19 * (rgba[at + 2] ?? 0)) / 256;
    const level = clamp01((luminance - tone.blackPoint) / span) ** exponent;
    const light = clamp01(level + (grainAt(index) - 0.5) * tone.grain);
    values[index] = inkIsLight ? light : 1 - light;
  }
  return { width, height, values };
}

/** The field's ink at a point in its own samples (sample centers at .5), blended between neighbours. */
export function coverageAt(field: CoverageField, x: number, y: number): number {
  const fx = Math.min(field.width - 1, Math.max(0, x - 0.5));
  const fy = Math.min(field.height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const row0 = y0 * field.width;
  const row1 = y1 * field.width;
  const top = (field.values[row0 + x0] ?? 0) * (1 - tx) + (field.values[row0 + x1] ?? 0) * tx;
  const bottom = (field.values[row1 + x0] ?? 0) * (1 - tx) + (field.values[row1 + x1] ?? 0) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Ink below the threshold (0–255) is none at all; the rest is kept as it is. */
export function thresholded(ink: number, threshold: number): number {
  return ink * 255 < threshold ? 0 : ink;
}

/** The character of a ramp (lightest first) for some ink. */
export function rampCharacter(ramp: readonly string[], coverage: number): string {
  return ramp[Math.min(ramp.length - 1, Math.round(clamp01(coverage) * (ramp.length - 1)))] ?? " ";
}

/** How light a CSS colour is, 0–1, from `#rgb`, `#rrggbb` or `rgb()`; null for anything else. */
export function colorLightness(color: string): number | null {
  const text = color.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text);
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(text);
  let channels: number[] | null = null;
  if (short) channels = short.slice(1).map((digit) => Number.parseInt(digit + digit, 16));
  else if (long) channels = long.slice(1).map((pair) => Number.parseInt(pair, 16));
  else if (rgb) channels = rgb.slice(1).map(Number);
  if (!channels) return null;
  const [red = 0, green = 0, blue = 0] = channels;
  return (54 * red + 183 * green + 19 * blue) / 256 / 255;
}
