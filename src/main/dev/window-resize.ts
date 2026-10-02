/**
 * The developer control's `window.resize` measurement: how far Live's native view trails the
 * studio window while the window's content area changes size frame by frame. The stage keeps the
 * chat column's width, so the slot grows and shrinks with the window by the same amount.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { BrowserWindow, Rectangle, WebContentsView } from "electron";

const SETTLE_POLL_MS = 2;
const SETTLE_MAX_MS = 1000;

/** A stepped resize: the total change of the content area, in how many steps and how long. */
export interface WindowResizeParams {
  deltaWidth: number;
  deltaHeight: number;
  steps: number;
  durationMs: number;
}

type Size = { width: number; height: number };

/** How many pixels the view's size is from the size a step asked of its slot. */
export function trailingPx(view: Size, expected: Size): number {
  return Math.max(Math.abs(view.width - expected.width), Math.abs(view.height - expected.height));
}

/** The largest and mean trail, and in how many of the steps the view was behind at all. */
export function summarizeTrail(trail: readonly number[]) {
  const behind = trail.filter((px) => px > 0).length;
  const mean = trail.length ? trail.reduce((sum, px) => sum + px, 0) / trail.length : 0;
  return { maxPx: Math.max(0, ...trail), meanPx: mean, stepsBehind: behind, steps: trail.length };
}

/** The slot's size after `step` of `steps`, from the view's size before the resize. */
function expectedAt(start: Rectangle, params: WindowResizeParams, step: number): Size {
  return {
    width: start.width + Math.round((params.deltaWidth * step) / params.steps),
    height: start.height + Math.round((params.deltaHeight * step) / params.steps),
  };
}

/** Milliseconds until the view has the expected size, or null if it never got there. */
async function settleMs(view: WebContentsView, expected: Size, now: () => number): Promise<number | null> {
  const begin = now();
  while (now() - begin < SETTLE_MAX_MS) {
    if (trailingPx(view.getBounds(), expected) === 0) return now() - begin;
    await sleep(SETTLE_POLL_MS);
  }
  return null;
}

/**
 * Resize the window step by step and read the view's bounds right after each change and again
 * just before the next one; the window gets its size back however the measurement ends.
 */
export async function measureWindowResize(
  win: BrowserWindow,
  view: WebContentsView,
  params: WindowResizeParams,
  now: () => number = () => performance.now(),
) {
  const [width, height] = win.getContentSize();
  const start = view.getBounds();
  const atChange: number[] = [];
  const beforeNext: number[] = [];
  const begin = now();
  try {
    for (let step = 1; step <= params.steps; step++) {
      const expected = expectedAt(start, params, step);
      win.setContentSize(width + expected.width - start.width, height + expected.height - start.height);
      atChange.push(trailingPx(view.getBounds(), expected));
      await sleep(Math.max(0, begin + (step * params.durationMs) / params.steps - now()));
      beforeNext.push(trailingPx(view.getBounds(), expected));
    }
    const settled = await settleMs(view, expectedAt(start, params, params.steps), now);
    return {
      atChange: summarizeTrail(atChange),
      beforeNext: summarizeTrail(beforeNext),
      settleMs: settled,
      start,
      end: view.getBounds(),
      elapsedMs: now() - begin,
    };
  } finally {
    win.setContentSize(width, height);
  }
}
