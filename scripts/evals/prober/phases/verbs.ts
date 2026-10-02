/**
 * ONE VERB, MEASURED. Shared by the acknowledgement phase and the interact phase so the two cannot
 * drift on what "acknowledged" means: the first page-side frame diff above the current baseline's
 * change threshold inside the ack window, and the first analyser reading above twice the pre-verb RMS
 * (and audible). A pixel response also has to beat the MATCHED CONTROL WINDOW, the same length of
 * time before the verb: a walking idle animation, weather or a settling follow camera clears the
 * threshold with no verb at all (`verbPixelExceededControl`).
 *
 * A verb a guard REFUSED is measured as nothing: `sent: false` with the reason, no window read (an
 * ambient change there would be credited to a verb that never went out).
 */
import { SECOND_MS } from "../../../../src/shared/duration.ts";
import { percentile } from "../frames.ts";
import type { LoggedFrame } from "../frame-log.ts";
import type { ProbeRms, ProbeSample } from "../instrument.ts";
import { verbPixelExceededControl } from "../verdicts.ts";
import type { BaselineName, PageBaseline } from "./baseline.ts";

/** How long after a verb its response is looked for. */
export const ACK_WINDOW_MS = 1.2 * SECOND_MS;
/** The pause before each verb, so the previous one's response has settled. */
export const VERB_SETTLE_MS = 0.9 * SECOND_MS;
/** RMS above this counts as audible output from the analyser tapped onto the destination. */
export const AUDIBLE_RMS = 0.002;
/** How many recent RMS readings set the pre-verb audio baseline, and its percentile. */
export const RMS_BASELINE_READINGS = 40;
export const RMS_BASELINE_PERCENTILE = 0.9;
/** An audio response must reach this multiple of the pre-verb RMS baseline. */
export const AUDIO_OVER_BASELINE = 2;
/** How long a verb key is held. */
export const VERB_KEY_HOLD_MS = 90;

/** Whether a verb went out, and the guard's reason when it did not. */
export interface VerbSend {
  sent: boolean;
  reason: string | null;
}

/** One verb's measurement. */
export interface VerbAcknowledgement {
  verb: string;
  sent: boolean;
  refusedWhy: string | null;
  pixelLatencyMs: number | null;
  audioLatencyMs: number | null;
  pixelDelta: number | null;
  audioDelta: number | null;
  /** The largest diff in the matched window before the verb, and how many readings it held. */
  pixelControlMax: number | null;
  pixelControlSamples: number;
  pixelExceededControl: boolean | null;
  baseline: BaselineName;
  changeThreshold: number;
}

/** What a verb measurement needs from the browser. */
export interface VerbDeps {
  sleep: (ms: number) => Promise<void>;
  pullSeries: () => Promise<unknown>;
  samples: () => readonly ProbeSample[];
  rms: () => readonly ProbeRms[];
  mark: (label: string) => Promise<number | null>;
  /** Capture a frame under the CALLER's phase, so each phase's evidence stays its own. */
  capture: (label: string) => Promise<LoggedFrame | null>;
  /** The baseline current now: post-entrance once the entrance was confirmed, else pre-gesture. */
  baseline: () => PageBaseline;
  log: (event: string, detail?: unknown) => void;
  ackWindowMs: number;
}

/** The first reading in the window that clears `over`, as latency and value. */
function firstAbove<T extends { t: number }>(
  readings: readonly T[],
  markT: number,
  windowMs: number,
  read: (r: T) => number,
  over: number,
): { latencyMs: number; value: number } | null {
  const hit = readings.find((r) => r.t >= markT && r.t <= markT + windowMs && read(r) > over);
  return hit ? { latencyMs: hit.t - markT, value: read(hit) } : null;
}

/** The matched pixel control window: the largest diff in the `windowMs` before the newest reading. */
function controlWindow(samples: readonly ProbeSample[], windowMs: number): { max: number | null; count: number } {
  const lastT = samples.length ? samples[samples.length - 1].t : null;
  if (lastT === null) return { max: null, count: 0 };
  const diffs = samples.filter((s) => s.t > lastT - windowMs && s.t <= lastT).map((s) => s.d);
  return { max: diffs.length ? Math.max(...diffs) : null, count: diffs.length };
}

/** Measure one verb: settle, read the controls, mark, send, wait the window, read the response. */
export async function measureVerb(
  deps: VerbDeps,
  verb: string,
  send: () => Promise<VerbSend>,
): Promise<VerbAcknowledgement> {
  await deps.sleep(VERB_SETTLE_MS);
  await deps.pullSeries();
  const preRms = deps
    .rms()
    .slice(-RMS_BASELINE_READINGS)
    .map((s) => s.rms);
  const rmsBaseline = preRms.length ? percentile(preRms, RMS_BASELINE_PERCENTILE) : 0;
  const control = controlWindow(deps.samples(), deps.ackWindowMs);
  const baseline = deps.baseline();
  const base = {
    verb,
    pixelControlMax: control.max,
    pixelControlSamples: control.count,
    baseline: baseline.name,
    changeThreshold: baseline.changeThreshold,
  };
  const markT = await deps.mark(`verb:${verb}`);
  const outcome = await send();
  const none = { pixelLatencyMs: null, audioLatencyMs: null, pixelDelta: null, audioDelta: null };
  if (!outcome.sent) {
    deps.log("verb.refused", { verb, reason: outcome.reason });
    const refusedWhy = outcome.reason ?? "refused";
    return { ...base, ...none, sent: false, refusedWhy, pixelExceededControl: null };
  }
  await deps.sleep(deps.ackWindowMs);
  await deps.pullSeries();
  const pixel =
    markT === null ? null : firstAbove(deps.samples(), markT, deps.ackWindowMs, (s) => s.d, baseline.changeThreshold);
  const audioOver = Math.max(rmsBaseline * AUDIO_OVER_BASELINE, AUDIBLE_RMS);
  const audio = markT === null ? null : firstAbove(deps.rms(), markT, deps.ackWindowMs, (s) => s.rms, audioOver);
  const pixelDelta = pixel?.value ?? null;
  await deps.capture(`after-${verb}`);
  return {
    ...base,
    sent: true,
    refusedWhy: null,
    pixelLatencyMs: pixel?.latencyMs ?? null,
    audioLatencyMs: audio?.latencyMs ?? null,
    pixelDelta,
    audioDelta: audio?.value ?? null,
    pixelExceededControl: verbPixelExceededControl({
      pixelDelta,
      pixelControlMax: control.max,
      pixelControlSamples: control.count,
    }),
  };
}

/** The sentence naming each refused verb and why, or `""`. */
export function refusedClause(verbs: readonly VerbAcknowledgement[]): string {
  const refused = verbs.filter((v) => !v.sent);
  if (!refused.length) return "";
  return ` ${refused.map((v) => `${v.verb} was NOT sent: the guard refused it (${v.refusedWhy})`).join("; ")}.`;
}

/** The sentence naming the baseline a threshold came from. */
export function baselineClause(name: BaselineName, threshold: number): string {
  return `the ${name} baseline (change threshold ${threshold.toFixed(4)})`;
}
