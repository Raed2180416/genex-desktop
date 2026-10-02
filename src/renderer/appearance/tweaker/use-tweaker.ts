/**
 * The colour tweaker's state: the open preset, every preset's draft, undo, and the live preview the
 * app shows while the panel is up. Drafts are remembered across reloads; the saved appearance is
 * never written, so closing the panel returns the app to it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { previewPalette, useAppearance } from "../store.ts";
import {
  type AnyRole,
  DEFAULT_CONTRAST,
  type Palette,
  type Scheme,
  type Shadow,
  type ShadowPlace,
  selectedPreset,
  type ThemePreset,
} from "../themes.ts";
import {
  changeCount,
  changesText,
  counterpart,
  type Draft,
  freshDraft,
  type KnobKey,
  LABEL_TYPE,
  LABEL_TYPE_KEYS,
  type LabelType,
  type LabelTypeKey,
  labelTypeText,
  logoWidthText,
  onStep,
  presetCode,
  shownPalette,
  tweakablePresets,
  withColor,
  withColors,
  withShadow,
} from "./tweaker.ts";
import { readTweakerMemory, type TweakerMemory, writeTweakerMemory } from "./tweaker-memory.ts";

/** Changes this close together are one undo step: a drag, or a colour being typed. */
const UNDO_GROUP_MS = 400;
/** The most undo steps kept. */
const UNDO_LIMIT = 200;
/** How long remembering waits for the drafts to settle. */
const REMEMBER_DELAY_MS = 250;
/** The colour a located role flashes in. */
const LOCATE_COLOR = "#ff00d4";
/** The variable theme.css sizes the sidebar wordmark by. */
const LOGO_WIDTH_VARIABLE = "--logo-width";

type Snapshot = { presetId: string; draft: Draft };

/** The drafts that differ from their presets, the open one first. */
function changedDrafts(presets: ThemePreset[], memory: TweakerMemory, open: ThemePreset): [ThemePreset, Palette][] {
  const ordered = [open, ...presets.filter((p) => p.id !== open.id)];
  return ordered.flatMap((p) => {
    const draft = memory.drafts[p.id];
    const palette = draft ? shownPalette(draft) : null;
    return palette && changeCount(p, palette) ? [[p, palette] as [ThemePreset, Palette]] : [];
  });
}

/** Show `palette` in the app once per frame, and the saved appearance again when the panel goes. */
function usePreview(scheme: Scheme, palette: Palette): void {
  useEffect(() => {
    const frame = requestAnimationFrame(() => previewPalette({ scheme, palette, contrast: DEFAULT_CONTRAST }));
    return () => cancelAnimationFrame(frame);
  }, [scheme, palette]);
  useEffect(() => () => previewPalette(null), []);
}

/** Draw the wordmark at the width being tried, and as designed again when the panel goes. */
function useLogoWidth(width: number | null): void {
  useEffect(() => {
    const root = document.documentElement.style;
    if (width === null) root.removeProperty(LOGO_WIDTH_VARIABLE);
    else root.setProperty(LOGO_WIDTH_VARIABLE, `${width}px`);
  }, [width]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(LOGO_WIDTH_VARIABLE);
    },
    [],
  );
}

/** Draw the sidebar labels and chat header title in the type being tried, and as designed again when the panel goes. */
function useLabelType(type: LabelType): void {
  useEffect(() => {
    const root = document.documentElement.style;
    for (const key of LABEL_TYPE_KEYS) {
      const value = type[key];
      const { variable, unit } = LABEL_TYPE[key];
      if (value === undefined) root.removeProperty(variable);
      else root.setProperty(variable, `${value}${unit}`);
    }
  }, [type]);
  useEffect(
    () => () => {
      for (const key of LABEL_TYPE_KEYS) document.documentElement.style.removeProperty(LABEL_TYPE[key].variable);
    },
    [],
  );
}

/** The label type with one measure tried on its step, or returned to the design (null). */
function withLabelMeasure(type: LabelType, key: LabelTypeKey, value: number | null): LabelType {
  const { [key]: _dropped, ...rest } = type;
  const kept = value === null ? null : onStep(key, value);
  return kept === null || kept === LABEL_TYPE[key].base ? rest : { ...rest, [key]: kept };
}

/** Each preset as `text` writes it, then the tried logo width and label type as lines for theme.css. */
function copied(
  presets: readonly (readonly [ThemePreset, Palette])[],
  memory: TweakerMemory,
  text: (preset: ThemePreset, palette: Palette) => string,
  between: string,
): string {
  return [...presets.map(([p, c]) => text(p, c)), logoWidthText(memory.logoWidth), labelTypeText(memory.labelType)]
    .filter(Boolean)
    .join(between);
}

/** Remember the memory once it has held still for a moment. */
function useRemembered(memory: TweakerMemory): void {
  useEffect(() => {
    const timer = setTimeout(() => writeTweakerMemory(memory), REMEMBER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [memory]);
}

/** The tweaker's state and actions. */
export function useTweaker() {
  const { appearance, scheme } = useAppearance();
  const [memory, setMemory] = useState<TweakerMemory>(readTweakerMemory);
  const [comparing, setComparing] = useState(false);
  const [locating, setLocating] = useState<AnyRole | null>(null);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const lastChange = useRef(0);
  const presets = useMemo(() => tweakablePresets(appearance.saved), [appearance.saved]);
  const preset = presets.find((p) => p.id === memory.presetId) ?? selectedPreset(appearance, scheme);
  const draftOf = (p: ThemePreset): Draft => memory.drafts[p.id] ?? freshDraft(p);
  const stored = memory.drafts[preset.id];
  const draft = useMemo(() => stored ?? freshDraft(preset), [stored, preset]);
  const palette = useMemo(() => shownPalette(draft), [draft]);
  const shown = useMemo(() => {
    if (comparing) return preset.colors;
    return locating ? { ...palette, [locating]: LOCATE_COLOR } : palette;
  }, [comparing, locating, palette, preset]);
  usePreview(preset.scheme, shown);
  useLogoWidth(memory.logoWidth);
  useLabelType(memory.labelType);
  useRemembered(memory);

  const putDraft = (presetId: string, next: Draft): void =>
    setMemory((m) => ({ ...m, presetId, drafts: { ...m.drafts, [presetId]: next } }));
  const setDraft = (next: Draft): void => {
    const now = performance.now();
    if (now - lastChange.current > UNDO_GROUP_MS) {
      undo.current = [...undo.current.slice(1 - UNDO_LIMIT), { presetId: preset.id, draft }];
      redo.current = [];
    }
    lastChange.current = now;
    putDraft(preset.id, next);
  };
  const step = (from: { current: Snapshot[] }, to: { current: Snapshot[] }): void => {
    const snapshot = from.current.at(-1);
    const target = presets.find((p) => p.id === snapshot?.presetId);
    if (!snapshot || !target) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, { presetId: target.id, draft: draftOf(target) }];
    lastChange.current = 0;
    putDraft(target.id, snapshot.draft);
  };
  const changed = changedDrafts(presets, memory, preset);

  return {
    presets,
    preset,
    palette,
    memory,
    changedCount: changeCount(preset, palette),
    canUndo: undo.current.length > 0,
    canRedo: redo.current.length > 0,
    knobs: draft.knobs,
    setComparing,
    setLocating,
    setColor: (role: AnyRole, color: string | undefined) => setDraft(withColor(draft, role, color)),
    setColors: (colors: Partial<Palette>) => setDraft(withColors(draft, colors)),
    setKnob: (key: KnobKey, value: number) => setDraft({ ...draft, knobs: { ...draft.knobs, [key]: value } }),
    resetRole: (role: AnyRole) => setDraft(withColor(draft, role, preset.colors[role])),
    setShadow: (place: ShadowPlace, shadow: Shadow | undefined) => setDraft(withShadow(draft, place, shadow)),
    resetShadow: (place: ShadowPlace) => setDraft(withShadow(draft, place, preset.colors.shadows?.[place])),
    resetAll: () => setDraft(freshDraft(preset)),
    undo: () => step(undo, redo),
    redo: () => step(redo, undo),
    openPreset: (id: string) => setMemory((m) => ({ ...m, presetId: id })),
    openScheme: (next: Scheme) => setMemory((m) => ({ ...m, presetId: counterpart(preset, next, presets).id })),
    place: (x: number, y: number) => setMemory((m) => ({ ...m, x, y })),
    setCollapsed: (collapsed: boolean) => setMemory((m) => ({ ...m, collapsed })),
    setLogoWidth: (logoWidth: number | null) => setMemory((m) => ({ ...m, logoWidth })),
    setLabelType: (key: LabelTypeKey, value: number | null) =>
      setMemory((m) => ({ ...m, labelType: withLabelMeasure(m.labelType, key, value) })),
    resetLabelType: () => setMemory((m) => ({ ...m, labelType: {} })),
    /** Every changed preset as its `PRESETS` entry (the open one's when nothing changed), then the theme.css lines. */
    code: () => copied(changed.length ? changed : [[preset, palette]], memory, presetCode, "\n"),
    /** Every changed preset's changes, one role per line, then the theme.css lines. */
    changes: () => copied(changed.length ? changed : [[preset, palette]], memory, changesText, "\n\n"),
  };
}

export type Tweaker = ReturnType<typeof useTweaker>;
