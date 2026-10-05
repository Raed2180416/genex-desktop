/**
 * The stage's loader picture, in home's dither marks (`home-backdrop/`): a small patch of halftone
 * dots that swells and shrinks like liquid. The geometry is pure; `drawDots` paints it in the
 * theme's ink, a little lighter than text. The chat's status line wears a tiny round one.
 */
import type { Rgb } from "../../ui/wire-art.ts";

/**
 * A plasma's frame in pixels, the step of its dot grid, how fine and how fast its waves run
 * (`detail`), how big its dots grow against the step, and the smallest dot drawn.
 */
export interface PlasmaLook {
  width: number;
  height: number;
  step: number;
  detail: number;
  dotScale: number;
  minRadius: number;
}

/** The stage's plasma. Dots smaller than its `minRadius` are left out, as home's are. */
export const PLASMA = { width: 52, height: 36, step: 3, detail: 1, dotScale: 0.5, minRadius: 0.3 } as const;
/** The status line's: a 14px orb on a finer grid, its waves twice as fine and twice as quick. */
export const STATUS_PLASMA = { width: 14, height: 14, step: 2, detail: 2, dotScale: 0.6, minRadius: 0.15 } as const;
/** The plasma flows: as many frames a second as it needs to look smooth. */
export const LOADER_FPS = 30;
/** How strongly the dots are inked: grey of the text's own colour, not black. */
const INK_ALPHA = 0.62;

/** A halftone dot: centre and radius in pixels. */
export type Dot = { x: number; y: number; r: number };

/** Every centre of the frame's dot grid. */
function gridCentres({ width, height, step }: PlasmaLook): Array<{ x: number; y: number }> {
  const centres: Array<{ x: number; y: number }> = [];
  for (let y = step / 2; y < height; y += step) for (let x = step / 2; x < width; x += step) centres.push({ x, y });
  return centres;
}

/** The plasma's dots at `seconds`, inside an oval that fades out at its edge. */
export function plasmaDots(seconds: number, look: PlasmaLook = PLASMA): Dot[] {
  const { width, height, step, detail } = look;
  const dots: Dot[] = [];
  const t = seconds * detail;
  for (const { x, y } of gridCentres(look)) {
    const ex = (x - width / 2) / (width / 2);
    const ey = (y - height / 2) / (height / 2);
    const mask = Math.max(0, 1 - (ex * ex + ey * ey) ** 1.4);
    // In grid steps, so the pattern keeps its shape at any size.
    const gx = (x / step) * detail;
    const gy = (y / step) * detail;
    const centre = { x: (width / step / 2) * detail, y: (height / step / 2) * detail };
    const wave =
      Math.sin(gx * 0.45 + t * 1.3) +
      Math.sin(gy * 0.66 - t * 1.7) +
      Math.sin((gx + gy) * 0.3 + t * 0.9) +
      Math.sin(Math.hypot(gx - centre.x, gy - centre.y) * 0.54 - t * 2.2);
    const r = ((0.5 + wave / 8) * mask) ** 1.3 * step * look.dotScale;
    if (r >= look.minRadius) dots.push({ x, y, r });
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
