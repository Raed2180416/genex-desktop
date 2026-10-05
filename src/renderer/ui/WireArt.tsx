/**
 * An empty state's 3D wireframe. One canvas, 30 fps while it is on screen, in an uninert region
 * and a visible window; one still frame under Reduce Motion. Colours follow the theme: the canvas'
 * own CSS colours (see `.wire-art` in empty-states.css) are read back and refreshed on theme change.
 */
import { useEffect, useRef, type JSX, type RefObject } from "react";
import { SECOND_MS } from "../../shared/duration.ts";
import { DARK_SCHEME_QUERY, REDUCED_MOTION_QUERY } from "./media-queries.ts";
import {
  drawWire,
  HANDOFF,
  HEIGHT,
  ideaSpin,
  STILL,
  WIDTH,
  type Rgb,
  type WireColors,
  type WireFrame,
  WireKind,
} from "./wire-art.ts";

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour the canvas understands (hex, rgb, oklab…) as sRGB bytes. */
export function toRgb(color: string): Rgb {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return [128, 128, 128];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#808080";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r = 128, g = 128, b = 128] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}
function readColors(canvas: HTMLCanvasElement): WireColors {
  const style = getComputedStyle(canvas);
  return {
    accent: toRgb(style.color),
    ink: toRgb(style.borderLeftColor),
    muted: toRgb(style.borderRightColor),
    fill: toRgb(style.outlineColor),
    page: toRgb(style.borderTopColor),
  };
}

/** The art redraws at most this many times a second while it animates, so once every `FRAME_MS`. */
const FPS = 30;
const FRAME_MS = SECOND_MS / FPS;
/** The canvas renders at the device's pixel ratio, within these bounds. */
const MAX_PIXEL_RATIO = 3;

type WireInput = { kind: WireKind; handoffAt: number | null };

/**
 * The frame to draw now: a still under Reduce Motion, the computer → crane hand-off while it runs,
 * else the kind's own loop since the art was born (or since the hand-off ended).
 */
function wireFrame({ kind, handoffAt }: WireInput, born: number, reduced: boolean, now: number): WireFrame {
  if (reduced) return { kind, t: STILL[kind] };
  if (kind !== WireKind.Building || handoffAt === null) return { kind, t: (now - born) / SECOND_MS };
  const s = (now - handoffAt) / SECOND_MS;
  if (s >= HANDOFF) return { kind, t: s - HANDOFF };
  const before = Math.max(0, (handoffAt - born) / SECOND_MS);
  return { kind: "handoff", s: Math.max(0, s), spin: ideaSpin(before) };
}

/**
 * Repaint when anything that shows or hides the art changes: the art scrolls in or out, the theme
 * lands as inline custom properties on <html>, `inert` hides the stage behind drawers and
 * dialogs, Reduce Motion or the colour scheme flips, or the window hides. Returns the unsubscribe.
 */
function watchRepaints(
  canvas: HTMLCanvasElement,
  on: { visible: (visible: boolean) => void; schedule: () => void; recolor: () => void },
  media: { reduced: MediaQueryList; dark: MediaQueryList },
): () => void {
  const intersection = new IntersectionObserver((records) => {
    on.visible(records.some((record) => record.isIntersecting));
    on.schedule();
  });
  intersection.observe(canvas);
  // The theme lands as inline custom properties on <html>; `inert` hides the stage behind drawers and dialogs.
  const themes = new MutationObserver(on.recolor);
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
  const inert = new MutationObserver(on.schedule);
  inert.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["inert"] });
  media.reduced.addEventListener("change", on.schedule);
  media.dark.addEventListener("change", on.recolor);
  document.addEventListener("visibilitychange", on.schedule);
  return () => {
    intersection.disconnect();
    themes.disconnect();
    inert.disconnect();
    media.reduced.removeEventListener("change", on.schedule);
    media.dark.removeEventListener("change", on.recolor);
    document.removeEventListener("visibilitychange", on.schedule);
  };
}

/**
 * The art's paint loop: a frame every FRAME_MS while it is on screen and moving, one still frame
 * otherwise. `schedule` repaints now and restarts the loop if it should run. Returns the stop.
 */
function startWireLoop(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  input: RefObject<WireInput>,
  redraw: RefObject<() => void>,
): () => void {
  const born = performance.now();
  const reduced = matchMedia(REDUCED_MOTION_QUERY);
  const dark = matchMedia(DARK_SCHEME_QUERY);
  let colors = readColors(canvas);
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let scale = 0;
  const paint = () => {
    const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
    if (ratio !== scale) {
      scale = ratio;
      canvas.width = Math.round(WIDTH * ratio);
      canvas.height = Math.round(HEIGHT * ratio);
    }
    try {
      drawWire(ctx, wireFrame(input.current, born, reduced.matches, performance.now()), colors, scale);
    } catch (error) {
      console.warn("Empty-state art stopped:", error);
      stop();
    }
  };
  const live = () => visible && !document.hidden && !reduced.matches && !canvas.closest("[inert]");
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const next = () => {
    timer = setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, FRAME_MS);
  };
  const tick = () => {
    frame = 0;
    if (!live()) return;
    paint();
    next();
  };
  const schedule = () => {
    stop();
    paint();
    if (live()) next();
  };
  const recolor = () => {
    colors = readColors(canvas);
    schedule();
  };
  redraw.current = schedule;
  const unwatch = watchRepaints(
    canvas,
    {
      visible: (value) => {
        visible = value;
      },
      schedule,
      recolor,
    },
    { reduced, dark },
  );
  schedule();
  return () => {
    stop();
    redraw.current = () => {};
    unwatch();
  };
}

export function WireArt({
  kind,
  handoffAt = null,
  className = "",
}: {
  kind: WireKind;
  /** When the idea → building hand-off began (performance.now()); the crane's loop starts after it. */
  handoffAt?: number | null;
  className?: string;
}): JSX.Element {
  const host = useRef<HTMLCanvasElement>(null);
  const input = useRef<WireInput>({ kind, handoffAt });
  input.current = { kind, handoffAt };
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    return startWireLoop(canvas, ctx, input, redraw);
  }, []);

  useEffect(() => {
    redraw.current();
  }, [kind, handoffAt]);

  return <canvas ref={host} aria-hidden="true" data-wire={kind} className={`wire-art ${className}`} />;
}
