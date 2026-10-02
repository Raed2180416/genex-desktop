/**
 * The tweaker's inline colour picker: a saturation × brightness square, a hue strip and a screen
 * pipette. It holds its own hue, so dragging through grey or black does not lose it.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { hex } from "../themes.ts";
import { type Hsv, hexToHsv, hsvToHex } from "./hsv.ts";

/** The browser's screen colour picker; Chromium has one, the DOM types do not. */
type EyeDropperApi = new () => { open(): Promise<{ sRGBHex: string }> };
const EyeDropper = (globalThis as { EyeDropper?: EyeDropperApi }).EyeDropper;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Track a press on `event`'s element: `at` hears the pointer's place in it, 0–1 on each axis, until release. */
function trackPointer(event: ReactPointerEvent<HTMLElement>, at: (x: number, y: number) => void): void {
  const element = event.currentTarget;
  const report = (e: { clientX: number; clientY: number }): void => {
    const box = element.getBoundingClientRect();
    at(clamp01((e.clientX - box.left) / box.width), clamp01((e.clientY - box.top) / box.height));
  };
  element.setPointerCapture(event.pointerId);
  report(event);
  const move = (e: PointerEvent): void => report(e);
  const end = (): void => {
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  event.preventDefault();
}

export function ColorPicker({ color, onChange }: { color: string; onChange(color: string): void }): JSX.Element {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  const produced = useRef(color);
  useEffect(() => {
    if (color !== produced.current) setHsv(hexToHsv(color));
    produced.current = color;
  }, [color]);
  const set = (next: Hsv): void => {
    setHsv(next);
    produced.current = hsvToHex(next);
    onChange(produced.current);
  };
  const pick = async (): Promise<void> => {
    if (!EyeDropper) return;
    const picked = await new EyeDropper().open().catch(() => null);
    const value = hex(picked?.sRGBHex);
    if (value) onChange(value);
  };
  const pure = `hsl(${hsv.h} 100% 50%)`;
  return (
    <div className="ct-picker">
      <div
        className="ct-sv"
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuenow={Math.round(hsv.v * 100)}
        tabIndex={-1}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
        onPointerDown={(e) => trackPointer(e, (x, y) => set({ ...hsv, s: x, v: 1 - y }))}
      >
        <span
          className="ct-thumb"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: color }}
        />
      </div>
      <div
        className="ct-hue"
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={-1}
        onPointerDown={(e) => trackPointer(e, (x) => set({ ...hsv, h: x * 359.9 }))}
      >
        <span className="ct-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: pure }} />
      </div>
      {EyeDropper && (
        <button type="button" className="ct-btn" onClick={() => void pick()}>
          Pick from screen
        </button>
      )}
    </div>
  );
}
