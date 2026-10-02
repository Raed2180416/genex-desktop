/**
 * The adapters from a live `FullPhaseContext` to each phase's injected browser calls. The phases stay
 * replayable against fakes; this module is where they meet the real page, and every input here goes
 * through the quick probe's guards.
 */
import { ProbePhase } from "../../vocabulary.ts";
import { dispatchLookDeltasInPage } from "../start-control.ts";
import type { PageBaseline } from "./baseline.ts";
import { type PitchRestoreDeps, restoreCameraPitch } from "./camera.ts";
import { DIRECTION_KEYS, type DirectionsDeps, type DragBurstDeps } from "./directions.ts";
import {
  dragFromCentre,
  type FullPhaseContext,
  hoverTo,
  logEvent,
  pull,
  sendClick,
  sendKey,
  shoot,
} from "./full-context.ts";
import type { LookDeps } from "./look.ts";
import { cameraNow, lastSampleT, markNow } from "./series.ts";
import type { SoakDeps } from "./soak.ts";
import { VERB_KEY_HOLD_MS, type VerbDeps, type VerbSend } from "./verbs.ts";

const logger = (ctx: FullPhaseContext, phase: ProbePhase) => (event: string, detail?: unknown) =>
  logEvent(ctx, phase, event, detail ?? null);

/** The closed-loop pitch restore on the live page. */
export function restoreDeps(ctx: FullPhaseContext): PitchRestoreDeps {
  return {
    viewportHeight: ctx.page.viewport().height,
    readCamera: () => cameraNow(ctx),
    drag: (dy) => dragFromCentre(ctx, 0, dy),
    sleep: ctx.sleep,
  };
}

/** Restore the pitch and log the outcome under `phase`. */
export async function restorePitch(ctx: FullPhaseContext, phase: ProbePhase, label: string): Promise<void> {
  const restored = await restoreCameraPitch(restoreDeps(ctx));
  logEvent(ctx, phase, "camera.restore", { label, ...restored });
}

/** The directions phase on the live page. */
export function directionsDeps(ctx: FullPhaseContext): DirectionsDeps {
  const phase = ProbePhase.Directions;
  return {
    keys: DIRECTION_KEYS,
    sleep: ctx.sleep,
    capture: (label) => shoot(ctx, phase, label),
    mark: (label) => markNow(ctx, label),
    press: async (key, holdMs) => (await sendKey(ctx, phase, key, holdMs)).sent,
    pullSeries: () => pull(ctx),
    samples: () => ctx.series.samples,
    readCamera: () => cameraNow(ctx),
    log: logger(ctx, phase),
  };
}

/** The drag burst on the live page. */
export function dragDeps(ctx: FullPhaseContext): DragBurstDeps {
  const phase = ProbePhase.Directions;
  return {
    viewport: ctx.page.viewport(),
    sleep: ctx.sleep,
    capture: (label) => shoot(ctx, phase, label),
    mark: (label) => markNow(ctx, label),
    drag: (dx, dy) => dragFromCentre(ctx, dx, dy),
    restore: () => restorePitch(ctx, phase, "directions:drag"),
    pullSeries: () => pull(ctx),
    samples: () => ctx.series.samples,
    log: logger(ctx, phase),
  };
}

/** A verb measurement on the live page under `phase`, against whichever baseline is current. */
export function verbDeps(
  ctx: FullPhaseContext,
  phase: ProbePhase,
  baseline: () => PageBaseline,
  ackWindowMs: number,
): VerbDeps {
  return {
    sleep: ctx.sleep,
    pullSeries: () => pull(ctx),
    samples: () => ctx.series.samples,
    rms: () => ctx.series.rms,
    mark: (label) => markNow(ctx, label),
    capture: (label) => shoot(ctx, phase, label),
    baseline,
    log: logger(ctx, phase),
    ackWindowMs,
  };
}

/** A key verb through the focus guard. */
export function keyVerb(ctx: FullPhaseContext, phase: ProbePhase, key: string): () => Promise<VerbSend> {
  return () => sendKey(ctx, phase, key, VERB_KEY_HOLD_MS);
}

/** A centre click through the chrome guard. */
export function clickVerb(ctx: FullPhaseContext, phase: ProbePhase): () => Promise<VerbSend> {
  return () => {
    const { width, height } = ctx.page.viewport();
    return sendClick(ctx, phase, Math.floor(width / 2), Math.floor(height / 2));
  };
}

/** A centre drag, then the pitch restore: without it this verb re-ruins the camera the directions put back. */
export function dragVerb(ctx: FullPhaseContext, phase: ProbePhase, dx: number, dy: number): () => Promise<VerbSend> {
  return async () => {
    const sent = await dragFromCentre(ctx, dx, dy);
    await restorePitch(ctx, phase, `${phase}:drag`);
    return { sent, reason: sent ? null : "the drag did not reach the page" };
  };
}

/** The look phase on the live page. */
export function lookDeps(ctx: FullPhaseContext): LookDeps {
  const phase = ProbePhase.Look;
  return {
    viewport: ctx.page.viewport(),
    dispatch: (dx, dy, drag) => ctx.page.evaluate(dispatchLookDeltasInPage, { dx, dy, ...drag }),
    mouse: ctx.page.mouse ?? null,
    readCamera: () => cameraNow(ctx),
    capture: (label) => shoot(ctx, phase, label),
    press: (key, holdMs) => sendKey(ctx, phase, key, holdMs),
    sleep: ctx.sleep,
    pullSeries: () => pull(ctx),
    lastSamplePageT: () => lastSampleT(ctx.series),
    log: logger(ctx, phase),
  };
}

/** The soak on the live page. */
export function soakDeps(ctx: FullPhaseContext): SoakDeps {
  const phase = ProbePhase.Soak;
  return {
    now: () => ctx.page.elapsedMs(),
    sleep: ctx.sleep,
    viewport: ctx.page.viewport(),
    press: async (key, holdMs) => (await sendKey(ctx, phase, key, holdMs)).sent,
    move: (x, y, steps) => hoverTo(ctx, x, y, steps),
    click: async (x, y) => (await sendClick(ctx, phase, x, y)).sent,
    capture: async (label) => (await shoot(ctx, phase, label)) !== null,
    pullSeries: () => pull(ctx),
  };
}
