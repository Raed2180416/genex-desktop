/**
 * Endless "working" animations (the status shimmer, busy dots and spinners, the working node's
 * pulse and placeholder sweep) run only while someone looks: the window is in front and visible,
 * and someone touched it in the last two minutes. While one runs, Chromium draws every frame,
 * which held a Mac at ~15% CPU through a build in the background; at rest it draws only when
 * something changes. `theme.css` pauses the endless animations under `data-motion="rest"`;
 * entrance and exit animations always finish.
 */
import { MINUTE_MS } from "../shared/duration.ts";

const MOTION_IDLE_MS = 2 * MINUTE_MS;
/** What counts as someone using the window. */
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/** Whether ambient motion runs; the value is the root's `data-motion`. */
export const Motion = { Live: "live", Rest: "rest" } as const;
export type Motion = (typeof Motion)[keyof typeof Motion];

/** The event target the watcher listens on: the window, for focus and input. */
export interface MotionTarget {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions): void;
}

/** The document: whether the window has focus and is on screen. */
export interface MotionDocument extends MotionTarget {
  hasFocus(): boolean;
  readonly visibilityState: DocumentVisibilityState;
}

/** Time, injectable so a test can drive it. */
export interface MotionClock {
  now(): number;
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(handle: number | undefined): void;
}

/** Report Live or Rest whenever it changes, starting now; the returned function stops watching. */
export function watchMotion(
  target: MotionTarget,
  doc: MotionDocument,
  clock: MotionClock,
  apply: (motion: Motion) => void,
): () => void {
  let focused = doc.hasFocus();
  let lastInput = clock.now();
  let timer: number | undefined;
  let current: Motion | null = null;
  const set = (motion: Motion): void => {
    if (motion === current) return;
    current = motion;
    apply(motion);
  };
  const check = (): void => {
    clock.clearTimeout(timer);
    timer = undefined;
    const idleFor = clock.now() - lastInput;
    const looking = focused && doc.visibilityState === "visible" && idleFor < MOTION_IDLE_MS;
    if (!looking) {
      set(Motion.Rest);
      return;
    }
    set(Motion.Live);
    timer = clock.setTimeout(check, MOTION_IDLE_MS - idleFor);
  };
  const input = (): void => {
    lastInput = clock.now();
    // A running timer re-reads `lastInput` when it fires; only a resting window needs waking.
    if (current !== Motion.Live) check();
  };
  const focus = (): void => {
    focused = true;
    input();
  };
  const blur = (): void => {
    focused = false;
    check();
  };
  const passive = { passive: true, capture: true };
  for (const type of INPUT_EVENTS) target.addEventListener(type, input, passive);
  target.addEventListener("focus", focus);
  target.addEventListener("blur", blur);
  doc.addEventListener("visibilitychange", check);
  check();
  return () => {
    for (const type of INPUT_EVENTS) target.removeEventListener(type, input, passive);
    target.removeEventListener("focus", focus);
    target.removeEventListener("blur", blur);
    doc.removeEventListener("visibilitychange", check);
    clock.clearTimeout(timer);
    timer = undefined;
  };
}

/** Is the window resting now (behind, hidden or untouched): motion nobody watches can be skipped. */
export const motionResting = (): boolean => document.documentElement.dataset.motion === Motion.Rest;

/** Keep the root's `data-motion` current for the life of the window. */
export function installMotionRest(): void {
  const clock: MotionClock = {
    now: () => performance.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
  watchMotion(window, document, clock, (motion) => {
    document.documentElement.dataset.motion = motion;
  });
}
