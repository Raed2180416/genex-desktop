/**
 * What the colour tweaker remembers between reloads: the preset it had open, every preset's draft,
 * where the panel sat and whether it was folded. A rebuild reloads the window mid-tweak, so the
 * drafts must survive it; a value that cannot be read is simply forgotten.
 */
import { readText, STORAGE_KEYS, writeText } from "../../storage.ts";
import { COLOR_ROLES, type ColorRole, DETAIL_ROLES, hex, type Palette, shadowsOf } from "../themes.ts";
import {
  type Draft,
  IDENTITY_KNOBS,
  KNOB_SPECS,
  type Knobs,
  LABEL_TYPE,
  LABEL_TYPE_KEYS,
  type LabelType,
  LOGO_WIDTH,
  onStep,
} from "./tweaker.ts";

export type TweakerMemory = {
  presetId: string | null;
  drafts: Record<string, Draft>;
  /** The panel's top-left corner in the window; null places it by default. */
  x: number | null;
  y: number | null;
  collapsed: boolean;
  /** The sidebar wordmark's width being tried, in px; null leaves it as designed. */
  logoWidth: number | null;
  /** The sidebar labels' and chat header title's type being tried; a measure left out is as designed. */
  labelType: LabelType;
};

/** The longest preset id a draft is kept under. */
const PRESET_ID_MAX = 100;

export const EMPTY_MEMORY: TweakerMemory = {
  presetId: null,
  drafts: {},
  x: null,
  y: null,
  collapsed: false,
  logoWidth: null,
  labelType: {},
};

function record(value: unknown): Record<string, unknown> {
  const isRecord = value !== null && typeof value === "object" && !Array.isArray(value);
  return isRecord ? (value as Record<string, unknown>) : {};
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;

/** A stored palette with every core role a hex colour, and the details and shadows that read; else null. */
function palette(value: unknown): Palette | null {
  const raw = record(value);
  const entries = COLOR_ROLES.map((role) => [role, hex(raw[role])] as const);
  if (entries.some(([, color]) => !color)) return null;
  const details = DETAIL_ROLES.flatMap((role) => {
    const color = hex(raw[role]);
    return color ? [[role, color] as const] : [];
  });
  const shadows = shadowsOf(raw.shadows);
  // Every core role was checked above; the details are those that read.
  const colors: Palette = Object.fromEntries([...entries, ...details]) as Record<ColorRole, string>;
  return shadows ? { ...colors, shadows } : colors;
}

/** Stored knobs, each clamped into its range; a missing one is at identity. */
function knobs(value: unknown): Knobs {
  const raw = record(value);
  const out = { ...IDENTITY_KNOBS };
  for (const { key, min, max } of KNOB_SPECS) {
    const n = raw[key];
    if (typeof n === "number" && Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, n));
  }
  return out;
}

function drafts(value: unknown): Record<string, Draft> {
  const out: Record<string, Draft> = {};
  for (const [id, item] of Object.entries(record(value))) {
    const colors = palette(record(item).colors);
    if (id.length <= PRESET_ID_MAX && colors) out[id] = { colors, knobs: knobs(record(item).knobs) };
  }
  return out;
}

/** A stored logo width, kept in its range; null when there is none or it is the designed one. */
function logoWidth(value: unknown): number | null {
  const n = finite(value);
  if (n === null || n === LOGO_WIDTH.base) return null;
  return Math.min(LOGO_WIDTH.max, Math.max(LOGO_WIDTH.min, n));
}

/** A stored label type: each measure on its step and in its range; one at its designed value is dropped. */
function labelType(value: unknown): LabelType {
  const raw = record(value);
  const out: LabelType = {};
  for (const key of LABEL_TYPE_KEYS) {
    const n = raw[key];
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    const kept = onStep(key, n);
    if (kept !== LABEL_TYPE[key].base) out[key] = kept;
  }
  return out;
}

/** The memory as stored, with anything unreadable forgotten. */
export function normalizeMemory(value: unknown): TweakerMemory {
  const raw = record(value);
  return {
    presetId: typeof raw.presetId === "string" ? raw.presetId.slice(0, PRESET_ID_MAX) : null,
    drafts: drafts(raw.drafts),
    x: finite(raw.x),
    y: finite(raw.y),
    collapsed: raw.collapsed === true,
    logoWidth: logoWidth(raw.logoWidth),
    labelType: labelType(raw.labelType),
  };
}

export function readTweakerMemory(): TweakerMemory {
  try {
    return normalizeMemory(JSON.parse(readText(STORAGE_KEYS.colorTweaker) ?? "{}"));
  } catch {
    return EMPTY_MEMORY;
  }
}

export function writeTweakerMemory(memory: TweakerMemory): void {
  writeText(STORAGE_KEYS.colorTweaker, JSON.stringify(memory));
}
