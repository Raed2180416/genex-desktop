/**
 * The app's one empty state: a 3D wireframe on a fading floor, a one-line title, a one-line
 * subtitle and a fixed button slot. Every part has a fixed height, so switching between states
 * never moves the art. When the stage goes from the first idea to building, the cube hands off
 * to the crane and the words swap in place (see wire-art.ts for the art's half of it).
 */
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type JSX, type ReactNode } from "react";
import { WireArt } from "./WireArt.tsx";
import { SECOND_MS } from "../../shared/duration.ts";
import { prefersReducedMotion } from "./media-queries.ts";
import { HANDOFF, WireKind } from "./wire-art.ts";

const FLOOR =
  "M8.2 0L-64 44M22.1 0L-32 44M36.1 0L0 44M50 0L32 44M64 0L64 44M78 0L96 44M91.9 0L128 44M105.9 0L160 44M119.8 0L192 44M0 .5H128M0 3.5H128M0 8H128M0 14H128M0 22H128M0 32.5H128";
const SWAP = "cubic-bezier(0.65, 0, 0.35, 1)";

/** One part of the handoff: how it moves, when it starts and how long it takes (ms). */
type Step = { keyframes: Keyframe[]; delay: number; duration: number; easing?: string };
type HandoffSteps = { outgoing: Step; incoming: Step; slot: Step; fading: Step | null };

const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const RISE_OUT: Keyframe[] = [
  { opacity: 1, transform: "none" },
  { opacity: 0, transform: "translateY(-4px)" },
];
const RISE_IN: Keyframe[] = [
  { opacity: 0, transform: "translateY(4px)" },
  { opacity: 1, transform: "none" },
];
/** Under Reduce Motion everything cross-fades at once, this fast (ms). */
const REDUCED_MS = 150;
/** Under Reduce Motion the swap settles just after that cross-fade (ms). */
const REDUCED_SETTLE_MS = 160;

/**
 * The idea → building handoff, part by part: the old words rise out, the new ones rise in, then
 * the button slot. Reduce Motion cross-fades them instead, and fades the old art out too.
 */
function handoffSteps(quick: boolean): HandoffSteps {
  if (quick)
    return {
      outgoing: { keyframes: FADE_OUT, delay: 0, duration: REDUCED_MS },
      incoming: { keyframes: FADE_IN, delay: 0, duration: REDUCED_MS },
      slot: { keyframes: FADE_IN, delay: 0, duration: REDUCED_MS, easing: "ease-out" },
      fading: { keyframes: FADE_OUT, delay: 0, duration: REDUCED_MS, easing: "linear" },
    };
  return {
    outgoing: { keyframes: RISE_OUT, delay: 300, duration: 175 },
    incoming: { keyframes: RISE_IN, delay: 440, duration: 210 },
    slot: { keyframes: RISE_IN, delay: 1000, duration: 300, easing: "ease-out" },
    fading: null,
  };
}

type Words = { title: string; subtitle: string };
type Handoff = { at: number; from: Words; reduced: boolean; settled: boolean };

export function EmptyState({
  art,
  title,
  subtitle,
  action,
  className = "",
  ...rest
}: {
  art: WireKind;
  title: string;
  subtitle: string;
  action?: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>): JSX.Element {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const previous = useRef({ art, title, subtitle });
  const outgoing = useRef<HTMLDivElement>(null);
  const incoming = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const fading = useRef<HTMLDivElement>(null);

  // Only the first idea → building change is choreographed; anything else simply switches.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { art, title, subtitle };
    if (before.art === art) return;
    if (before.art === WireKind.Idea && art === WireKind.Building) {
      setHandoff({
        at: performance.now(),
        from: { title: before.title, subtitle: before.subtitle },
        reduced: prefersReducedMotion(),
        settled: false,
      });
    } else setHandoff(null);
  }, [art, title, subtitle]);

  // Web Animations rather than CSS, so the 150 ms Reduce Motion cross-fade survives the app's
  // global reduced-motion override.
  useLayoutEffect(() => {
    if (!handoff || handoff.settled) return;
    const quick = handoff.reduced;
    const steps = handoffSteps(quick);
    const parts: Record<keyof HandoffSteps, HTMLElement | null> = {
      outgoing: outgoing.current,
      incoming: incoming.current,
      slot: slot.current,
      fading: fading.current,
    };
    const animations = (Object.keys(steps) as Array<keyof HandoffSteps>).map((part) => {
      const step = steps[part];
      if (!step) return undefined;
      return parts[part]?.animate(step.keyframes, {
        delay: step.delay,
        duration: step.duration,
        easing: step.easing ?? SWAP,
        fill: "both",
      });
    });
    const timer = setTimeout(
      () => setHandoff((value) => value && { ...value, settled: true }),
      quick ? REDUCED_SETTLE_MS : HANDOFF * SECOND_MS,
    );
    return () => {
      clearTimeout(timer);
      for (const animation of animations) animation?.cancel();
    };
  }, [handoff]);

  const swapping = !!handoff && !handoff.settled;
  return (
    <div className={`empty-state ${className}`} {...rest}>
      <div className="empty-state-art" aria-hidden="true">
        <svg className="empty-state-floor" viewBox="0 0 128 44" preserveAspectRatio="none">
          <path d={FLOOR} />
        </svg>
        <span className="empty-state-glow" />
        <WireArt kind={art} handoffAt={handoff && !handoff.reduced ? handoff.at : null} />
        {swapping && handoff.reduced && (
          <div ref={fading} className="empty-state-art-fading">
            <WireArt kind={WireKind.Idea} />
          </div>
        )}
      </div>
      <div className="empty-state-copy">
        {swapping && (
          <div ref={outgoing} className="empty-state-words" aria-hidden="true">
            <h2 className="empty-state-title">{handoff.from.title}</h2>
            <p className="empty-state-subtitle">{handoff.from.subtitle}</p>
          </div>
        )}
        <div ref={incoming} className="empty-state-words">
          <h2 className="empty-state-title">{title}</h2>
          <p className="empty-state-subtitle">{subtitle}</p>
        </div>
      </div>
      <div ref={slot} className="empty-state-slot">
        {action}
      </div>
    </div>
  );
}
