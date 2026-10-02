/**
 * The boot phase: poll the largest canvas until it draws something that is not one flat colour, or
 * the first-draw timeout runs out. The first non-degenerate frame is the moment frames may be written
 * (Rule 18), and it is written as the boot frame. The verdict needs no uncaught error before it.
 */
import { SECOND_MS } from "../../../../src/shared/duration.ts";
import { CheckResult, ProbePhase } from "../../vocabulary.ts";
import { CanvasState, type PageEvents } from "../driver.ts";
import { writeFrame } from "../frame-log.ts";
import { type DegeneracyReport, degeneracyReport } from "../frames.ts";
import { decodePng } from "../png.ts";
import type { PhaseContext } from "./context.ts";
import { currentOrigin } from "./context.ts";

/** How often the boot phase looks at the canvas. */
export const BOOT_POLL_MS = 0.5 * SECOND_MS;
/** The label of the first non-degenerate frame. */
export const FIRST_DRAW_LABEL = "first-draw";
const HTTP_ERROR_MIN = 400;

/** What the boot phase saw. */
export interface BootObservation {
  firstRenderMs: number | null;
  /** Captures that returned an image, found no canvas, or failed. */
  images: number;
  noCanvas: number;
  failed: number;
  /** The degeneracy of the last image that was still flat, for the detail. */
  lastDegeneracy: DegeneracyReport | null;
}

/** Look at the canvas once; the degeneracy when an image came back, `null` otherwise. */
async function lookOnce(ctx: PhaseContext, seen: BootObservation): Promise<DegeneracyReport | null> {
  const shot = await ctx.page.captureCanvas();
  if (shot.state === CanvasState.NoCanvas) {
    seen.noCanvas++;
    return null;
  }
  if (shot.state === CanvasState.Failed) {
    seen.failed++;
    return null;
  }
  let report: DegeneracyReport;
  try {
    report = degeneracyReport(decodePng(shot.capture.png));
  } catch {
    seen.failed++;
    return null;
  }
  seen.images++;
  if (!report.degenerate) {
    const atMs = ctx.page.elapsedMs();
    seen.firstRenderMs = atMs;
    ctx.frames.firstRenderMs = atMs;
    writeFrame(ctx.frames, shot.capture, {
      phase: ProbePhase.Boot,
      label: FIRST_DRAW_LABEL,
      atMs,
      origin: currentOrigin(ctx),
    });
  }
  return report;
}

/** Poll until the first non-degenerate draw or `firstDrawTimeoutMs` of run time. */
export async function bootPhase(ctx: PhaseContext, firstDrawTimeoutMs: number): Promise<BootObservation> {
  const seen: BootObservation = { firstRenderMs: null, images: 0, noCanvas: 0, failed: 0, lastDegeneracy: null };
  while (ctx.page.elapsedMs() <= firstDrawTimeoutMs) {
    const report = await lookOnce(ctx, seen);
    if (seen.firstRenderMs !== null) return seen;
    if (report) seen.lastDegeneracy = report;
    await ctx.sleep(BOOT_POLL_MS);
  }
  return seen;
}

/** Whether the page threw before it first drew. */
export function uncaughtBeforeFirstDraw(boot: BootObservation, events: PageEvents): boolean {
  const drawn = boot.firstRenderMs ?? Number.POSITIVE_INFINITY;
  return events.pageErrors.some((e) => e.atMs <= drawn);
}

/** The boot verdict and the sentence behind it. */
export interface BootVerdict {
  result: CheckResult;
  detail: string;
}

/**
 * Pass = a non-degenerate canvas and no uncaught error before it (§8.1). A document that answered an
 * HTTP error, a page with no canvas, or a canvas that stayed flat is a fail; `unknown` only when no
 * capture could be read at all.
 */
export function bootVerdict(boot: BootObservation, events: PageEvents, timeoutMs: number): BootVerdict {
  const status = events.documentStatus;
  if (status !== null && status >= HTTP_ERROR_MIN) {
    return { result: CheckResult.Fail, detail: `The entry document answered HTTP ${status}.` };
  }
  if (boot.firstRenderMs !== null) {
    if (uncaughtBeforeFirstDraw(boot, events)) {
      return {
        result: CheckResult.Fail,
        detail: `The canvas first drew at ${Math.round(boot.firstRenderMs)}ms, but an uncaught error was thrown before it.`,
      };
    }
    return {
      result: CheckResult.Pass,
      detail: `The canvas first drew non-degenerate pixels at ${Math.round(boot.firstRenderMs)}ms with no uncaught error before it.`,
    };
  }
  const seconds = Math.round(timeoutMs / SECOND_MS);
  if (boot.images > 0) {
    const why = boot.lastDegeneracy?.reasons.join("; ") ?? "flat";
    return {
      result: CheckResult.Fail,
      detail: `The canvas never drew non-degenerate pixels within ${seconds}s (${why}).`,
    };
  }
  if (boot.noCanvas > 0) {
    return { result: CheckResult.Fail, detail: `No visible canvas appeared within ${seconds}s.` };
  }
  return {
    result: CheckResult.Unknown,
    detail: `No canvas capture could be read in ${seconds}s (${boot.failed} failed), so there is no evidence either way.`,
  };
}
