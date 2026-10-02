/**
 * The pre-registered endpoints (§7.1): per axis, the one primary metric that may carry inference
 * (Holm across primaries) and the secondaries; every other metric prints under "Descriptive (no
 * inference)" with no direction words and a chance note. The metric table says how each metric is
 * read from a row (a missing measurement is null, never zero), which way is better, and whether it
 * compares on a log scale. `ENDPOINTS_SHA` hashes the registration so a changed endpoint moves the
 * grading pin `endpointsSha`.
 */
import crypto from "node:crypto";
import { MINUTE_MS } from "../../../src/shared/duration.ts";
import { isMeasured, type RunRow } from "../ledger/types.ts";
import { Axis, CheckResult, Coverage, EndedHow, ResultLabel, RowKind } from "../vocabulary.ts";
import { BetterIs, DOT, formatMinutes, formatPercent, formatUsd, MetricScale } from "./compare.ts";
import { holm, type KmObservation, mannWhitney, median } from "./stats.ts";

/** The window of the pre-registered "playable within 30 minutes" rate. */
export const PLAYABLE_WINDOW_MS = 30 * MINUTE_MS;
/** A descriptive metric "moved" when its descriptive Mann–Whitney p falls below this. */
export const DESCRIPTIVE_ALPHA = 0.05;

/** The metrics a report reads, in their §7 spelling. */
export const MetricId = {
  WallMs: "time.wallMs",
  ToDoneMs: "time.toDoneMs",
  FirstBootMs: "time.firstBootMs",
  FirstPlayableMs: "time.firstPlayableMs",
  FirstPreviewMs: "time.firstPreviewMs",
  DelegationP50Ms: "time.delegationP50Ms",
  UncachedInput: "tokens.uncachedInput",
  CacheWrite: "tokens.cacheWrite",
  CacheRead: "tokens.cacheRead",
  Output: "tokens.output",
  Reasoning: "tokens.reasoning",
  LeadPeakPct: "context.leadPeakPct",
  Compactions: "context.compactions",
  ModelCalls: "calls.modelCalls",
  ToolCalls: "calls.tools.total",
  ApiEquivalentUsd: "cost.apiEquivalentUsd",
  ScoreAllRuns: "checklist.scoreAllRuns",
  ScoreGraded: "checklist.scoreGraded",
  BootRate: "rate.boot",
  PlayableWithin30Min: "rate.playableWithin30Min",
  PairwiseOverallWin: "pairwise.overallWinRate",
} as const;
export type MetricId = (typeof MetricId)[keyof typeof MetricId];

/** How a metric aggregates: a value per run, a 0/1 per run, a time-to-event, or a campaign-level pairwise rate. */
export const MetricKind = {
  Continuous: "continuous",
  Rate: "rate",
  Survival: "survival",
  Pairwise: "pairwise",
} as const;
export type MetricKind = (typeof MetricKind)[keyof typeof MetricKind];

/** How a metric's value prints. */
export const MetricUnit = {
  Ms: "ms",
  Tokens: "tokens",
  Count: "count",
  Percent: "percent",
  Usd: "usd",
  Fraction: "fraction",
} as const;
export type MetricUnit = (typeof MetricUnit)[keyof typeof MetricUnit];

/** One metric: how it reads, prints and compares. */
export interface MetricSpec {
  id: MetricId;
  kind: MetricKind;
  unit: MetricUnit;
  betterIs: BetterIs;
  scale: MetricScale;
  /** The run's value, or null when it was not measured (never zero for a missing value). Null for campaign-level metrics. */
  read: ((row: RunRow) => number | null) | null;
}

/** Whether a row counts in n (§10.5): a build, not void, and no harness failure. */
export function countsInN(row: RunRow): boolean {
  return row.kind === RowKind.Build && row.outcome.harnessFailure === null && row.campaignVoid === null;
}

const TIMING_OFF: ReadonlySet<Coverage> = new Set([Coverage.TraceDirty, Coverage.Unmeasured]);
const TOKENS_OK: ReadonlySet<Coverage> = new Set([Coverage.Full, Coverage.StreamOnly]);

function timing(row: RunRow, value: number | null): number | null {
  return TIMING_OFF.has(row.time.coverage) ? null : value;
}

function tokens(row: RunRow, value: number): number | null {
  return TOKENS_OK.has(row.tokens.coverage) ? value : null;
}

function fullOnly(coverage: Coverage, value: number | null): number | null {
  return coverage === Coverage.Full ? value : null;
}

/** 1 when the run booted (L1), 0 when it failed or shipped no build, null when nobody probed it. */
export function bootOutcome(row: RunRow): number | null {
  if (row.outcome.noBuild !== null) return 0;
  if (!row.probe || row.probe.l1Gate === CheckResult.Unknown) return null;
  return row.probe.l1Gate === CheckResult.Pass ? 1 : 0;
}

function playableWithinWindow(row: RunRow): number | null {
  if (row.outcome.noBuild !== null) return 0;
  if (row.time.coverage !== Coverage.Full) return null;
  if (row.time.firstPlayableMs !== null) return row.time.firstPlayableMs <= PLAYABLE_WINDOW_MS ? 1 : 0;
  return row.probe ? 0 : null;
}

function checklistScore(row: RunRow): number | null {
  if (!row.checklist || row.checklist.graderVoid !== null) return null;
  return row.checklist.scoreAllRuns;
}

function cost(row: RunRow): number | null {
  const usd = row.cost.apiEquivalentUsd;
  return isMeasured(usd) ? tokens(row, usd) : null;
}

const spec = (
  id: MetricId,
  kind: MetricKind,
  unit: MetricUnit,
  betterIs: BetterIs,
  read: MetricSpec["read"],
): MetricSpec => {
  const logScale = unit === MetricUnit.Ms || unit === MetricUnit.Tokens || unit === MetricUnit.Count;
  return { id, kind, unit, betterIs, scale: logScale ? MetricScale.Log : MetricScale.Linear, read };
};

const { Continuous, Rate, Survival, Pairwise } = MetricKind;
const { Higher, Lower } = BetterIs;

/** Every metric the report reads. Time, token and call metrics compare on a log scale (§10.2). */
export const METRICS: Record<MetricId, MetricSpec> = {
  [MetricId.WallMs]: spec(MetricId.WallMs, Continuous, MetricUnit.Ms, Lower, (r) => timing(r, r.time.wallMs)),
  [MetricId.ToDoneMs]: spec(MetricId.ToDoneMs, Survival, MetricUnit.Ms, Lower, (r) => timing(r, r.time.toDoneMs)),
  [MetricId.FirstBootMs]: spec(MetricId.FirstBootMs, Survival, MetricUnit.Ms, Lower, (r) =>
    timing(r, r.time.firstBootMs),
  ),
  [MetricId.FirstPlayableMs]: spec(MetricId.FirstPlayableMs, Survival, MetricUnit.Ms, Lower, (r) =>
    timing(r, r.time.firstPlayableMs),
  ),
  [MetricId.FirstPreviewMs]: spec(MetricId.FirstPreviewMs, Continuous, MetricUnit.Ms, Lower, (r) =>
    timing(r, r.time.firstPreviewMs),
  ),
  [MetricId.DelegationP50Ms]: spec(MetricId.DelegationP50Ms, Continuous, MetricUnit.Ms, Lower, (r) =>
    timing(r, r.time.delegationP50Ms),
  ),
  [MetricId.UncachedInput]: spec(MetricId.UncachedInput, Continuous, MetricUnit.Tokens, Lower, (r) =>
    tokens(r, r.tokens.uncachedInput),
  ),
  [MetricId.CacheWrite]: spec(MetricId.CacheWrite, Continuous, MetricUnit.Tokens, Lower, (r) =>
    tokens(r, r.tokens.cacheWrite),
  ),
  [MetricId.CacheRead]: spec(MetricId.CacheRead, Continuous, MetricUnit.Tokens, Lower, (r) =>
    tokens(r, r.tokens.cacheRead),
  ),
  [MetricId.Output]: spec(MetricId.Output, Continuous, MetricUnit.Tokens, Lower, (r) => tokens(r, r.tokens.output)),
  [MetricId.Reasoning]: spec(MetricId.Reasoning, Continuous, MetricUnit.Tokens, Lower, (r) =>
    tokens(r, r.tokens.reasoning),
  ),
  [MetricId.LeadPeakPct]: spec(MetricId.LeadPeakPct, Continuous, MetricUnit.Percent, Lower, (r) =>
    fullOnly(r.context.coverage, r.context.leadPeakPct),
  ),
  [MetricId.Compactions]: spec(MetricId.Compactions, Continuous, MetricUnit.Count, Lower, (r) =>
    fullOnly(r.context.coverage, r.context.compactions),
  ),
  [MetricId.ModelCalls]: spec(MetricId.ModelCalls, Continuous, MetricUnit.Count, Lower, (r) =>
    fullOnly(r.calls.coverage, r.calls.modelCalls),
  ),
  [MetricId.ToolCalls]: spec(MetricId.ToolCalls, Continuous, MetricUnit.Count, Lower, (r) =>
    fullOnly(r.calls.coverage, r.calls.tools.total),
  ),
  [MetricId.ApiEquivalentUsd]: spec(MetricId.ApiEquivalentUsd, Continuous, MetricUnit.Usd, Lower, cost),
  [MetricId.ScoreAllRuns]: spec(MetricId.ScoreAllRuns, Continuous, MetricUnit.Fraction, Higher, checklistScore),
  [MetricId.ScoreGraded]: spec(MetricId.ScoreGraded, Continuous, MetricUnit.Fraction, Higher, (r) =>
    r.checklist?.graderVoid === null ? r.checklist.scoreGraded : null,
  ),
  [MetricId.BootRate]: spec(MetricId.BootRate, Rate, MetricUnit.Fraction, Higher, bootOutcome),
  [MetricId.PlayableWithin30Min]: spec(
    MetricId.PlayableWithin30Min,
    Rate,
    MetricUnit.Fraction,
    Higher,
    playableWithinWindow,
  ),
  [MetricId.PairwiseOverallWin]: spec(MetricId.PairwiseOverallWin, Pairwise, MetricUnit.Fraction, Higher, null),
};

/** A survival metric as a Kaplan–Meier observation: the event time, or censored at the wall time; null when unmeasured. */
export function survivalObservation(row: RunRow, metric: MetricId): KmObservation | null {
  const read = METRICS[metric].read;
  if (METRICS[metric].kind !== MetricKind.Survival || !read) return null;
  const toDone = metric === MetricId.ToDoneMs;
  // Rule 22: a run with no build never booted, whatever a stale timing field says.
  const value = !toDone && row.outcome.noBuild !== null ? null : read(row);
  if (value !== null) return { time: value, event: true };
  const wall = METRICS[MetricId.WallMs].read?.(row) ?? null;
  if (wall === null) return null;
  if (toDone) return row.outcome.endedHow === EndedHow.AgentFinished ? null : { time: wall, event: false };
  const neverReached = row.outcome.noBuild !== null || (row.probe !== null && row.time.coverage === Coverage.Full);
  return neverReached ? { time: wall, event: false } : null;
}

/** One axis's registration. */
export interface Endpoint {
  axis: Axis;
  primary: MetricId;
  secondaries: readonly MetricId[];
  label: string;
  /**
   * The owner's smallest change in the primary worth acting on, in the primary's own unit (a
   * fraction for scores and rates). A report whose observed noise (the MDE) is at or above it says
   * "more reps or cases needed" instead of a verdict (§10.7).
   */
  minActionableDelta: number;
}

const PRODUCT_SECONDARIES = [MetricId.PlayableWithin30Min, MetricId.PairwiseOverallWin] as const;
const VERSION_SECONDARIES = [MetricId.ScoreAllRuns, MetricId.FirstBootMs] as const;
/** Ten points of checklist score: the smallest product or model difference worth acting on. */
const SCORE_MIN_ACTIONABLE_DELTA = 0.1;
/** Ten points of boot rate: the smallest version difference worth acting on. */
const BOOT_RATE_MIN_ACTIONABLE_DELTA = 0.1;

/** The pre-registered endpoints per axis (§7.1). */
export const ENDPOINTS: Record<Axis, Endpoint> = {
  [Axis.ProductDefault]: {
    axis: Axis.ProductDefault,
    primary: MetricId.ScoreAllRuns,
    secondaries: PRODUCT_SECONDARIES,
    label: "Genex product default vs raw CLI",
    minActionableDelta: SCORE_MIN_ACTIONABLE_DELTA,
  },
  [Axis.ProductHarness]: {
    axis: Axis.ProductHarness,
    primary: MetricId.ScoreAllRuns,
    secondaries: PRODUCT_SECONDARIES,
    label: "Genex harness (Loop off) vs raw CLI: isolates harness from stop policy",
    minActionableDelta: SCORE_MIN_ACTIONABLE_DELTA,
  },
  [Axis.ModelStack]: {
    axis: Axis.ModelStack,
    primary: MetricId.ScoreAllRuns,
    secondaries: PRODUCT_SECONDARIES,
    label: "model stack",
    minActionableDelta: SCORE_MIN_ACTIONABLE_DELTA,
  },
  [Axis.Version]: {
    axis: Axis.Version,
    primary: MetricId.BootRate,
    secondaries: VERSION_SECONDARIES,
    label: "same lane, base vs candidate build",
    minActionableDelta: BOOT_RATE_MIN_ACTIONABLE_DELTA,
  },
  [Axis.Cli]: {
    axis: Axis.Cli,
    primary: MetricId.BootRate,
    secondaries: VERSION_SECONDARIES,
    label: "same lane, epoch vs epoch",
    minActionableDelta: BOOT_RATE_MIN_ACTIONABLE_DELTA,
  },
};

/**
 * The canonical registration the hash covers: the endpoints with their actionable thresholds, and
 * every metric's direction and scale.
 */
function registration(): string {
  const metrics = Object.values(METRICS).map((m) => [m.id, m.kind, m.unit, m.betterIs, m.scale]);
  const endpoints = Object.values(ENDPOINTS).map((e) => [e.axis, e.primary, [...e.secondaries], e.minActionableDelta]);
  return JSON.stringify({ metrics, endpoints, playableWindowMs: PLAYABLE_WINDOW_MS });
}

/** sha256[:12] of the registration: the `endpointsSha` grading pin. */
export const ENDPOINTS_SHA = crypto.createHash("sha256").update(registration()).digest("hex").slice(0, 12);

/** What prints beside an axis result when its inference is limited. */
export interface AxisContext {
  sameCampaign: boolean;
  neutralGrader: boolean;
}

/** The labels an axis result carries: grader-family confounding on the model axis, drift across campaigns. */
export function axisLabels(axis: Axis, context: AxisContext): ResultLabel[] {
  const labels: ResultLabel[] = [];
  if (axis === Axis.ModelStack && !context.neutralGrader) labels.push(ResultLabel.GraderFamilyConfounded);
  const longitudinal = axis === Axis.Version || axis === Axis.Cli;
  if (longitudinal && !context.sameCampaign) labels.push(ResultLabel.Longitudinal);
  return labels;
}

/** One primary's raw p-value and its Holm-adjusted p-value across the primaries of the report. */
export interface AdjustedPrimary {
  metric: MetricId;
  p: number;
  adjusted: number;
}

/** Holm-adjust the primaries only (§7.1); secondaries and descriptive metrics never enter the family. */
export function adjustPrimaries(primaries: readonly { metric: MetricId; p: number }[]): AdjustedPrimary[] {
  const adjusted = holm(primaries.map((entry) => entry.p));
  return primaries.map((entry, i) => ({ ...entry, adjusted: adjusted[i] }));
}

/** A metric value as words and units; null prints as "not measured", never as a zero. */
export function formatMetricValue(metric: MetricId, value: number | null): string {
  if (value === null) return "not measured";
  const unit = METRICS[metric].unit;
  if (unit === MetricUnit.Ms) return formatMinutes(value / MINUTE_MS);
  if (unit === MetricUnit.Usd) return `${formatUsd(value)} est.`;
  if (unit === MetricUnit.Percent) return formatPercent(value);
  if (unit === MetricUnit.Fraction) return formatPercent(value * 100);
  return Math.round(value).toLocaleString("en-US");
}

/** One descriptive metric's two arms. */
export interface DescriptiveEntry {
  metric: MetricId;
  a: readonly number[];
  b: readonly number[];
}

function describeArm(metric: MetricId, label: string, values: readonly number[]): string {
  return `${label} median ${formatMetricValue(metric, median(values))} (n=${values.length})`;
}

/**
 * The "Descriptive (no inference)" block: medians and a descriptive Mann–Whitney p per metric, no
 * direction words, and "k of m descriptive metrics moved; about m×0.05 would by chance".
 */
export function renderDescriptive(entries: readonly DescriptiveEntry[], labelA: string, labelB: string): string {
  const lines = ["Descriptive (no inference)"];
  let moved = 0;
  for (const { metric, a, b } of entries) {
    const test = mannWhitney(a, b);
    if (test && test.p < DESCRIPTIVE_ALPHA) moved += 1;
    const p = test ? `Mann–Whitney p=${test.p.toFixed(2)} (descriptive)` : "Mann–Whitney not computable";
    lines.push(`  ${metric}: ${[describeArm(metric, labelA, a), describeArm(metric, labelB, b), p].join(DOT)}`);
  }
  const m = entries.length;
  lines.push(
    `  ${moved} of ${m} descriptive metrics moved; about ${(m * DESCRIPTIVE_ALPHA).toFixed(1)} would by chance`,
  );
  return lines.join("\n");
}
