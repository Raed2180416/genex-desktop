/**
 * How a label changes its words: it stays long enough to read, the new words fade in, and its width
 * glides to theirs so what follows it (a chevron) slides along instead of jumping.
 *
 * A status label that stays long enough to read. Work reports its phases faster than a person can
 * read them ("Sending", "Working" for 25 ms, then "Thinking"); each label stays at least
 * `LABEL_DWELL_MS`, then the newest one wanted replaces it and those in between are skipped.
 */
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./media-queries.ts";
import { OPEN_MS, SMOOTH_OUT, sizeGlide } from "./motion.ts";

/** How long a status label stays before another may replace it. */
export const LABEL_DWELL_MS = 400;
/** How long a new label takes to fade in where the old one stood. */
const LABEL_FADE_MS = 200;
/** How faint a new label starts. */
const LABEL_FADE_FROM = 0.2;

/** The label on show and since when (epoch ms). */
export interface ShownLabel {
  text: string;
  since: number;
}

/**
 * What the line shows when it wants `wanted` at `now`: the label already shown until it has been up
 * `dwellMs`, then `wanted`. `wakeAt` is when to look again, or null when nothing waits.
 */
export function steadyLabel(
  shown: ShownLabel | null,
  wanted: string,
  now: number,
  dwellMs = LABEL_DWELL_MS,
): { shown: ShownLabel; wakeAt: number | null } {
  if (!shown) return { shown: { text: wanted, since: now }, wakeAt: null };
  if (shown.text === wanted) return { shown, wakeAt: null };
  const readAt = shown.since + dwellMs;
  if (now >= readAt) return { shown: { text: wanted, since: now }, wakeAt: null };
  return { shown, wakeAt: readAt };
}

/** The label to show for `wanted` now, held by {@link steadyLabel}; it changes on its own when due. */
export function useSteadyLabel(wanted: string): string {
  const [shown, setShown] = useState<ShownLabel>(() => ({ text: wanted, since: Date.now() }));
  useEffect(() => {
    const next = steadyLabel(shown, wanted, Date.now());
    if (next.shown !== shown) {
      setShown(next.shown);
      return;
    }
    if (next.wakeAt === null) return;
    // The timer runs out when the shown label has been read; a newer wish replaces the timer.
    const timer = setTimeout(() => setShown({ text: wanted, since: Date.now() }), next.wakeAt - Date.now());
    return () => clearTimeout(timer);
  }, [shown, wanted]);
  return shown.text;
}

/** Fades `text` in each time it changes after the first, in the element `ref` names. */
export function useTextFade(ref: RefObject<HTMLElement | null>, text: string): void {
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of words is what fades in
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    ref.current?.animate([{ opacity: LABEL_FADE_FROM }, { opacity: 1 }], {
      duration: LABEL_FADE_MS,
      easing: "ease-out",
    });
  }, [text]);
}

/**
 * Glides the element's width from its old words' width to the new ones' each time `text` changes
 * after the first, so what follows it slides along. While it glides the words are cut rather than
 * ended with an ellipsis, which would flicker as the width catches up.
 */
export function useWidthGlide(ref: RefObject<HTMLElement | null>, text: string): void {
  const shown = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of words is what glides
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Mid-glide the old width is where the box is now; the new one is the words' own.
    const from = running.current ? element.getBoundingClientRect().width : shown.current;
    running.current?.cancel();
    running.current = null;
    element.style.textOverflow = "";
    const to = element.getBoundingClientRect().width;
    shown.current = to;
    // A width of nothing was measured while hidden: there is nothing to glide from or to.
    const glide = to ? sizeGlide(from || null, to) : null;
    if (!glide || prefersReducedMotion()) return;
    element.style.textOverflow = "clip";
    const animation = element.animate([{ width: `${glide.from}px` }, { width: `${glide.to}px` }], {
      duration: OPEN_MS,
      easing: SMOOTH_OUT,
    });
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      running.current = null;
      element.style.textOverflow = "";
    };
  }, [text]);
}
