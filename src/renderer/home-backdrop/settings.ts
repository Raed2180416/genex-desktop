/**
 * Home's background: one picture behind the first screen, drawn through an effect (lines, dots or
 * characters) in the theme's ink. These are its settings, what each may hold, and how a saved copy
 * is read back; the drawing is `draw.ts`'s.
 */
import { Scheme } from "../appearance/themes.ts";

/** How the picture is drawn; Off shows home's plain page. */
export const BackdropEffect = {
  Off: "off",
  Lines: "lines",
  Dots: "dots",
  Ascii: "ascii",
} as const;
export type BackdropEffect = (typeof BackdropEffect)[keyof typeof BackdropEffect];

/** A dot grid: square, or every other row shifted half a step (Ben-Day). */
export const DotGrid = {
  Regular: "regular",
  Benday: "benday",
} as const;
export type DotGrid = (typeof DotGrid)[keyof typeof DotGrid];

/** A colour for each theme: marks that suit the light page and the dark one differ. */
export type BackdropColors = Record<Scheme, string | null>;

/** Every setting of home's background. */
export interface BackdropSettings {
  effect: BackdropEffect;
  /** A bundled picture (`builtin:<name>`) or one the user added (`upload:<id>`). */
  image: string;
  /** How strongly the drawing shows over the page, 0.1–1. */
  strength: number;
  /** The marks' colour in each theme as `#rrggbb`, or null for that theme's text colour. */
  colors: BackdropColors;
  /** Marks are left out where the ink is below this, 0–255: a hard edge between drawn and bare. */
  threshold: number;
  /** Image preparation, before the effect: softening, noise, midtones and levels. */
  blur: number;
  grain: number;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
  /** Lines: columns across, and segments down each one. */
  lineColumns: number;
  lineRows: number;
  /** Dots: the grid's step and the smallest and largest dot, in points, and the grid's turn. */
  dotStep: number;
  dotMin: number;
  dotMax: number;
  dotGrid: DotGrid;
  dotAngle: number;
  /** Dots: a dot's corner radius in points (past half its size it is round), and how far dots stray. */
  dotCorner: number;
  dotNoise: number;
  /** ASCII: characters across, and the ramp from lightest to densest. */
  asciiColumns: number;
  asciiCharacters: string;
}

/** Decimal places a number shows: as many as its step has. */
export function backdropDecimals(key: BackdropNumber): number {
  const step = String(BACKDROP_RANGES[key].step);
  return step.includes(".") ? (step.split(".")[1]?.length ?? 0) : 0;
}

/** The numeric settings. */
export type BackdropNumber = {
  [K in keyof BackdropSettings]: BackdropSettings[K] extends number ? K : never;
}[keyof BackdropSettings];

/** Each number's range and step: what a slider offers and what a saved value is held to. */
export const BACKDROP_RANGES = {
  strength: { min: 0.1, max: 1, step: 0.05 },
  threshold: { min: 0, max: 255, step: 1 },
  blur: { min: 0, max: 10, step: 0.5 },
  grain: { min: 0, max: 1, step: 0.01 },
  gamma: { min: 0.2, max: 3, step: 0.05 },
  blackPoint: { min: 0, max: 254, step: 1 },
  whitePoint: { min: 1, max: 255, step: 1 },
  lineColumns: { min: 40, max: 240, step: 1 },
  lineRows: { min: 20, max: 200, step: 1 },
  dotStep: { min: 4, max: 24, step: 1 },
  dotMin: { min: 0, max: 12, step: 0.5 },
  dotMax: { min: 1, max: 24, step: 0.5 },
  dotAngle: { min: 0, max: 90, step: 1 },
  dotCorner: { min: 0, max: 12, step: 0.5 },
  dotNoise: { min: 0, max: 1, step: 0.05 },
  asciiColumns: { min: 40, max: 240, step: 1 },
} as const satisfies Record<BackdropNumber, { min: number; max: number; step: number }>;

/** The longest character ramp, and the shortest that still draws a picture. */
export const ASCII_RAMP_MAX = 24;
const ASCII_RAMP_MIN = 2;

/** The picture home starts with. */
export const DEFAULT_BACKDROP_IMAGE = "builtin:city";
const IMAGE_ID = /^(builtin:[a-z-]+|upload:[A-Za-z0-9-]+)$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/;

export const DEFAULT_BACKDROP: Readonly<BackdropSettings> = Object.freeze({
  effect: BackdropEffect.Lines,
  image: DEFAULT_BACKDROP_IMAGE,
  strength: 0.8,
  colors: Object.freeze({ [Scheme.Light]: "#e8e8e8", [Scheme.Dark]: "#171717" }),
  threshold: 30,
  blur: 5,
  grain: 0.2,
  gamma: 1,
  blackPoint: 30,
  whitePoint: 210,
  lineColumns: 240,
  lineRows: 161,
  dotStep: 5,
  dotMin: 3,
  dotMax: 9.5,
  dotGrid: DotGrid.Regular,
  dotAngle: 48,
  dotCorner: 11,
  dotNoise: 0.1,
  asciiColumns: 140,
  asciiCharacters: " .:-=+*#%@",
});

const EFFECTS: ReadonlySet<unknown> = new Set<BackdropEffect>(Object.values(BackdropEffect));
const GRIDS: ReadonlySet<unknown> = new Set<DotGrid>(Object.values(DotGrid));

/** `value` snapped to `key`'s step inside its range, else the default. */
function numberIn(key: BackdropNumber, value: unknown): number {
  const { min, max, step } = BACKDROP_RANGES[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BACKDROP[key];
  const snapped = Math.round((value - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(4));
}

/** A ramp of printable characters, cut to its longest; too short a ramp is the default. */
function rampFrom(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BACKDROP.asciiCharacters;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
  const ramp = Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ""))
    .slice(0, ASCII_RAMP_MAX)
    .join("");
  return Array.from(ramp).length >= ASCII_RAMP_MIN ? ramp : DEFAULT_BACKDROP.asciiCharacters;
}

/** A saved colour: hex as it is, null as the theme's, anything else `fallback`. */
function colorFrom(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (typeof value === "string" && HEX_COLOR.test(value.toLowerCase())) return value.toLowerCase();
  return fallback;
}

/**
 * Each theme's saved colour. A single `color` saved before the themes had their own is not read:
 * no one theme can claim it, so each starts from its default.
 */
function colorsFrom(value: unknown): BackdropColors {
  const saved = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    [Scheme.Light]: colorFrom(saved[Scheme.Light], DEFAULT_BACKDROP.colors[Scheme.Light]),
    [Scheme.Dark]: colorFrom(saved[Scheme.Dark], DEFAULT_BACKDROP.colors[Scheme.Dark]),
  };
}

/** Settings read from anything saved: each field it cannot use is its default. */
export function normalizeBackdrop(saved: unknown): BackdropSettings {
  const source = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const numbers = Object.fromEntries(
    (Object.keys(BACKDROP_RANGES) as BackdropNumber[]).map((key) => [key, numberIn(key, source[key])]),
  ) as Pick<BackdropSettings, BackdropNumber>;
  const settings: BackdropSettings = {
    ...numbers,
    effect: EFFECTS.has(source.effect) ? (source.effect as BackdropEffect) : DEFAULT_BACKDROP.effect,
    image: typeof source.image === "string" && IMAGE_ID.test(source.image) ? source.image : DEFAULT_BACKDROP.image,
    dotGrid: GRIDS.has(source.dotGrid) ? (source.dotGrid as DotGrid) : DEFAULT_BACKDROP.dotGrid,
    colors: colorsFrom(source.colors),
    asciiCharacters: rampFrom(source.asciiCharacters),
  };
  // Levels need a range to stretch: the white point stays above the black.
  if (settings.whitePoint <= settings.blackPoint) settings.whitePoint = Math.min(255, settings.blackPoint + 1);
  if (settings.dotMin > settings.dotMax) settings.dotMin = settings.dotMax;
  return settings;
}
