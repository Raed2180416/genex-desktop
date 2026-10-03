/**
 * The stage's loader picture, in home's dither marks (`home-backdrop/`): a small patch of halftone
 * dots that swells and shrinks like liquid. The geometry is pure; `drawDots` paints it in the
 * theme's ink, a little lighter than text.
 */
import type { Rgb } from "../../ui/wire-art.ts";

/** The plasma: its frame in pixels and the step of its dot grid. */
export const PLASMA = { width: 52, height: 36, step: 3 } as const;
/** The plasma flows: as many frames a second as it needs to look smooth. */
export const LOADER_FPS = 30;
/** Dots smaller than this radius are left out, as home's are. */
const DOT_MIN_RADIUS = 0.3;
/** How strongly the dots are inked: grey of the text's own colour, not black. */
const INK_ALPHA = 0.62;

/** A halftone dot: centre and radius in pixels. */
export type Dot = { x: number; y: number; r: number };

/** Every centre of the frame's dot grid. */
function gridCentres(): Array<{ x: number; y: number }> {
  const { width, height, step } = PLASMA;
  const centres: Array<{ x: number; y: number }> = [];
  for (let y = step / 2; y < height; y += step) for (let x = step / 2; x < width; x += step) centres.push({ x, y });
  return centres;
}

/** The plasma's dots at `seconds`, inside an oval that fades out at its edge. */
export function plasmaDots(seconds: number): Dot[] {
  const { width, height, step } = PLASMA;
  const dots: Dot[] = [];
  for (const { x, y } of gridCentres()) {
    const ex = (x - width / 2) / (width / 2);
    const ey = (y - height / 2) / (height / 2);
    const mask = Math.max(0, 1 - (ex * ex + ey * ey) ** 1.4);
    // In grid steps, so the pattern keeps its shape at any size.
    const gx = x / step;
    const gy = y / step;
    const wave =
      Math.sin(gx * 0.45 + seconds * 1.3) +
      Math.sin(gy * 0.66 - seconds * 1.7) +
      Math.sin((gx + gy) * 0.3 + seconds * 0.9) +
      Math.sin(Math.hypot(gx - width / step / 2, gy - height / step / 2) * 0.54 - seconds * 2.2);
    const r = ((0.5 + wave / 8) * mask) ** 1.3 * step * 0.5;
    if (r >= DOT_MIN_RADIUS) dots.push({ x, y, r });
  }
  return dots;
}

/** Paint `dots` on a `PLASMA`-sized canvas, in one fill of `ink`. */
export function drawDots(ctx: CanvasRenderingContext2D, dots: Dot[], ink: Rgb): void {
  ctx.fillStyle = `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${INK_ALPHA})`;
  ctx.beginPath();
  for (const dot of dots) {
    ctx.moveTo(dot.x + dot.r, dot.y);
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
  }
  ctx.fill();
}
