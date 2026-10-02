/**
 * Where the developer colour tweaker lives: only in an unpackaged developer run, toggled by ⌥⌘C
 * (Ctrl+Alt+C off macOS), and loaded on first open so a packaged app never fetches it.
 * It is switched off in code between tuning sessions: see `COLOR_TWEAKER_ON` below.
 */
import type { JSX } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useDeveloperRun } from "../../state/hooks.ts";
import { readText, STORAGE_KEYS, writeText } from "../../storage.ts";

const ColorTweaker = lazy(() => import("./ColorTweaker.tsx"));

/**
 * The colour tweaker is hidden while the presets are settled, not removed: to tune colours again,
 * set this to true and press ⌥⌘C in a `studio:dev` window ("Colour tweaker" in docs/agent/design.md).
 */
const COLOR_TWEAKER_ON = false;

/** ⌥⌘C, by the key's place so Option's character (ç) does not hide it. */
const isToggle = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey && event.code === "KeyC";

export function ColorTweakerHost(): JSX.Element | null {
  const offered = useDeveloperRun() && COLOR_TWEAKER_ON;
  const [open, setOpen] = useState(() => readText(STORAGE_KEYS.colorTweakerOpen) === "1");
  useEffect(() => {
    writeText(STORAGE_KEYS.colorTweakerOpen, open ? "1" : "0");
  }, [open]);
  useEffect(() => {
    if (!offered) return;
    const onKey = (event: KeyboardEvent): void => {
      if (!isToggle(event)) return;
      event.preventDefault();
      setOpen((was) => !was);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offered]);
  if (!offered || !open) return null;
  return (
    <Suspense fallback={null}>
      <ColorTweaker onClose={() => setOpen(false)} />
    </Suspense>
  );
}
