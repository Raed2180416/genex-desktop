/**
 * The full prober's page-side series, accumulated for the whole run: every mirror diff (`d`, page
 * clock `t`) and every analyser RMS reading, pulled by cursor. Windows are cut by PAGE time from the
 * accumulated log, so a phase that measures a burst after its capture still sees the whole window
 * (the page buffer keeps every reading until it is pulled). A fresh document re-installs the
 * instrument with empty arrays; the log notices the new install stamp and restarts its cursors,
 * since reading the new document with the old cursors returns nothing forever.
 *
 * The quick probe's `baseline.ts` cursor reads the same buffer independently: the page's `series()`
 * is a non-destructive slice, so the two never disturb each other.
 */
import { percentile } from "../frames.ts";
import type { CameraSample, ProbeRms, ProbeSample, ProbeSeries } from "../instrument.ts";
import type { PhaseContext } from "./context.ts";

const MEDIAN = 0.5;

/** Everything pulled from the page so far. */
export interface SeriesLog {
  samples: ProbeSample[];
  rms: ProbeRms[];
  nextFrame: number;
  nextRms: number;
  /** The install stamp of the document the cursors belong to. */
  document: number | null;
  /** How many times a fresh document re-installed the instrument. */
  reinstalls: number;
}

/** An empty log. */
export function createSeriesLog(): SeriesLog {
  return { samples: [], rms: [], nextFrame: 0, nextRms: 0, document: null, reinstalls: 0 };
}

interface PageProbe {
  series(fromFrame: number, fromRms: number): ProbeSeries;
  mark(label: string): number;
  snapshot(): { camera?: { samples?: CameraSample[] } };
}

/** Page-side: the instrument's frame and RMS series from the two cursors, or `null` when absent. */
export function readSeriesInPage(arg: { fromFrame: number; fromRms: number }): ProbeSeries | null {
  const probe = (window as unknown as { __GENEX_PROBE__?: PageProbe }).__GENEX_PROBE__;
  return probe ? probe.series(arg.fromFrame, arg.fromRms) : null;
}

/** Page-side: take a mark and answer the page-clock time it was taken at, or `null` when absent. */
export function markInPage(label: string): number | null {
  const probe = (window as unknown as { __GENEX_PROBE__?: PageProbe }).__GENEX_PROBE__;
  if (!probe) return null;
  const t = probe.mark(label);
  return typeof t === "number" ? t : null;
}

/** Page-side: the newest engine camera sample only, so the camera ring is not shipped for one reading. */
export function readCameraInPage(): CameraSample | null {
  const probe = (window as unknown as { __GENEX_PROBE__?: PageProbe }).__GENEX_PROBE__;
  const samples = probe?.snapshot().camera?.samples ?? [];
  return samples.length ? samples[samples.length - 1] : null;
}

/** Pull what the page sampled since the cursors; `false` when the page did not answer. */
export async function pullSeries(ctx: PhaseContext, log: SeriesLog): Promise<boolean> {
  const got = await ctx.page.evaluate(readSeriesInPage, { fromFrame: log.nextFrame, fromRms: log.nextRms });
  if (!got) return false;
  if (log.document === null || got.installedAt === log.document) {
    append(log, got);
    return true;
  }
  log.reinstalls++;
  log.document = got.installedAt;
  const again = await ctx.page.evaluate(readSeriesInPage, { fromFrame: 0, fromRms: 0 });
  if (!again) {
    log.nextFrame = 0;
    log.nextRms = 0;
    return false;
  }
  append(log, again);
  return true;
}

function append(log: SeriesLog, got: ProbeSeries): void {
  log.document = got.installedAt;
  log.samples.push(...got.frames);
  log.rms.push(...got.rms);
  log.nextFrame = got.nextFrame;
  log.nextRms = got.nextRms;
}

/** Take a mark in the page; its page-clock time, or `null` when the page did not answer. */
export async function markNow(ctx: PhaseContext, label: string): Promise<number | null> {
  return ctx.page.evaluate(markInPage, label);
}

/** The engine camera now, or `null` when it was never read. */
export async function cameraNow(ctx: PhaseContext): Promise<CameraSample | null> {
  return ctx.page.evaluate(readCameraInPage, undefined);
}

/** The page-clock time of the newest sample pulled so far, or `null`. */
export function lastSampleT(log: SeriesLog): number | null {
  return log.samples.length ? log.samples[log.samples.length - 1].t : null;
}

/** The samples whose page time lies in `[fromT, toT]`. */
export function samplesBetween(samples: readonly ProbeSample[], fromT: number, toT: number): ProbeSample[] {
  return samples.filter((s) => s.t >= fromT && s.t <= toT);
}

/** The median gap between consecutive samples under `maxGapMs`: how finely the sampler resolved time. */
export function samplerResolutionMs(samples: readonly ProbeSample[], maxGapMs: number): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].t - samples[i - 1].t;
    if (gap > 0 && gap < maxGapMs) gaps.push(gap);
  }
  return gaps.length ? percentile(gaps, MEDIAN) : null;
}
