import { SECOND_MS } from "../shared/duration.ts";
const SHOW_FALLBACK_MS = 5 * SECOND_MS;
interface PaintWindow {
  once(event: "ready-to-show", listener: () => void): unknown;
  isDestroyed(): boolean;
  show(): void;
}
/** Arm before navigation, including a bounded fallback for a page that never paints. */
export function showAfterPaint(
  win: PaintWindow,
  schedule: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
): void {
  let shown = false;
  let cancel = () => {};
  const show = () => {
    if (shown) return;
    shown = true;
    cancel();
    if (!win.isDestroyed()) win.show();
  };
  win.once("ready-to-show", show);
  cancel = schedule(show, SHOW_FALLBACK_MS);
}
