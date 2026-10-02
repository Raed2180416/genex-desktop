/**
 * The comparator (§10.2), ported from genex-demo `evals/harness/report/compare.ts`. The limits live
 * in the type: below `DIRECTION_FLOOR` distinct cases the result is `refused` and has no delta
 * field at all; below `MAGNITUDE_FLOOR` it may claim a direction only; at or above it, a magnitude
 * prints only as "observed +40%, 95% CI [−15%, +95%], n=8". n is the number of distinct cases:
 * reps collapse to per-case medians first and never raise it. Time, token and call metrics compare
 * on a log scale, as a ratio of geometric means. Rates (0/1 per run) never collapse to medians:
 * each case is a 2×2 stratum of pass counts, pooled as a Mantel–Haenszel odds ratio with a Wilson
 * interval per arm, under the same case floors (`compareRateCases`).
 */
import {
  type Interval,
  mantelHaenszel,
  median,
  pairedLogRatio,
  ruleOfThreeUpper,
  sampleSd,
  type Stratum,
  tCritical95,
  wilson,
} from "./stats.ts";

/** Below this many distinct cases: no aggregate delta, percentage, arrow or colour. */
export const DIRECTION_FLOOR = 5;
/** Below this many distinct cases: direction only. */
export const MAGNITUDE_FLOOR = 8;

/** The fixed phrase for an interval that spans zero; never "no significant difference". */
export const NO_DETECTABLE_DIFFERENCE = "no difference large enough for this design to detect";

/** U+2212 MINUS SIGN, the glyph every signed percentage prints. */
export const MINUS = "−";
/** U+00B7 MIDDLE DOT between fields. */
export const DOT = " · ";
/** A pass mark. */
export const TICK = "✓";
/** A fail mark. */
export const CROSS = "✗";

/** The three things a comparison can be. */
export const ComparisonKind = {
  Refused: "refused",
  Direction: "direction",
  Magnitude: "magnitude",
} as const;
export type ComparisonKind = (typeof ComparisonKind)[keyof typeof ComparisonKind];

/** Which arm the metric favours. */
export const Direction = {
  A: "A",
  B: "B",
  None: "none",
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** Which way is good for a metric; the choice is always printed, so a wrong one is visible. */
export const BetterIs = {
  Higher: "higher",
  Lower: "lower",
} as const;
export type BetterIs = (typeof BetterIs)[keyof typeof BetterIs];

/** How a metric is compared: raw differences, or log differences (ratio of geometric means). */
export const MetricScale = {
  Linear: "linear",
  Log: "log",
} as const;
export type MetricScale = (typeof MetricScale)[keyof typeof MetricScale];

/** One case's pair of values: arm A, arm B. */
export interface Pair {
  a: number;
  b: number;
}

/** How to label and read a comparison. */
export interface CompareOptions {
  labelA?: string;
  labelB?: string;
  metric?: string;
  betterIs?: BetterIs;
  scale?: MetricScale;
}

/** n < 5, or a log metric with a non-positive value: raw pairs and a refusal, and no delta field. */
export interface ComparisonRefused {
  kind: typeof ComparisonKind.Refused;
  n: number;
  pairs: Pair[];
  refusal: string;
}

/** 5 ≤ n < 8: a direction may be claimed; there is no magnitude field. */
export interface ComparisonDirection {
  kind: typeof ComparisonKind.Direction;
  n: number;
  pairs: Pair[];
  direction: Direction;
  favouringA: number;
  favouringB: number;
  ties: number;
  statement: string;
}

/** n ≥ 8: the only variant that carries a number. */
export interface ComparisonMagnitude {
  kind: typeof ComparisonKind.Magnitude;
  n: number;
  pairs: Pair[];
  direction: Direction;
  /** B against A in percent: the mean difference over mean(A), or (ratio of geometric means − 1) on a log scale. */
  observedPct: number;
  ci95Pct: [number, number];
  spansZero: boolean;
  statement: string;
}

/** Any comparison result. */
export type Comparison = ComparisonRefused | ComparisonDirection | ComparisonMagnitude;

/** `+40%` or `−15%`: always signed, always U+2212. */
export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? MINUS : "+"}${Math.abs(rounded)}%`;
}

/** `31%`: unsigned, for proportions and bounds. */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** `$2.40`: two decimals always. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** `22 min`; a positive duration under a minute is `<1 min`, never `0 min`. */
export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded === 0 && minutes > 0) return "<1 min";
  return `${rounded} min`;
}

function assertUsableSample(valuesA: readonly number[], valuesB: readonly number[], n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`compare: n must be a non-negative integer, got ${n}`);
  if (valuesA.length !== n || valuesB.length !== n) {
    throw new TypeError(
      `compare: n=${n} but got ${valuesA.length} A-values and ${valuesB.length} B-values. ` +
        "A caller whose n disagrees with its data is confused about its own sample size.",
    );
  }
  for (const value of [...valuesA, ...valuesB]) {
    if (!Number.isFinite(value)) throw new TypeError(`compare: every value must be finite, got ${value}`);
  }
}

function directionOf(difference: number, betterIs: BetterIs): Direction {
  if (difference === 0) return Direction.None;
  const bIsHigher = difference > 0;
  const bIsBetter = betterIs === BetterIs.Higher ? bIsHigher : !bIsHigher;
  return bIsBetter ? Direction.B : Direction.A;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** What every branch of `compare` shares. */
interface Frame {
  metric: string;
  labelA: string;
  labelB: string;
  betterIs: BetterIs;
  scale: MetricScale;
  n: number;
  pairs: Pair[];
  differences: number[];
}

/** The refusal every comparison below `DIRECTION_FLOOR` cases prints after its metric. */
function floorRefusal(n: number, raw: string): string {
  return (
    `n=${n} is below the N=${DIRECTION_FLOOR} floor — no aggregate delta, percentage, arrow or colour. ` +
    `${raw} only. (Every per-case finding still stands; it is the aggregate that is refused.)`
  );
}

function refused(frame: Frame, reason: string): ComparisonRefused {
  return { kind: ComparisonKind.Refused, n: frame.n, pairs: frame.pairs, refusal: `${frame.metric}${reason}` };
}

function directionStatement(frame: Frame, direction: Direction, favouringA: number, favouringB: number): string {
  const head = `${frame.metric}n=${frame.n} — direction may be claimed, magnitude may not.`;
  if (direction === Direction.None) {
    return `${head} ${NO_DETECTABLE_DIFFERENCE.charAt(0).toUpperCase()}${NO_DETECTABLE_DIFFERENCE.slice(1)}.`;
  }
  const winner = direction === Direction.A ? frame.labelA : frame.labelB;
  const count = direction === Direction.A ? favouringA : favouringB;
  return `${head} Direction favours ${winner} (${count} of ${frame.n} pairs, ${frame.betterIs} is better). No magnitude at this n.`;
}

function directionResult(frame: Frame, suffix = ""): ComparisonDirection {
  const favouringA = frame.differences.filter((d) => directionOf(d, frame.betterIs) === Direction.A).length;
  const favouringB = frame.differences.filter((d) => directionOf(d, frame.betterIs) === Direction.B).length;
  const direction = directionOf(average(frame.differences), frame.betterIs);
  return {
    kind: ComparisonKind.Direction,
    n: frame.n,
    pairs: frame.pairs,
    direction,
    favouringA,
    favouringB,
    ties: frame.differences.filter((d) => d === 0).length,
    statement: `${directionStatement(frame, direction, favouringA, favouringB)}${suffix}`,
  };
}

/** The percent change of B against A and its interval, or null when there is no percentage to take. */
function percentChange(frame: Frame): { observed: number; lo: number; hi: number; degenerate: boolean } | null {
  if (frame.scale === MetricScale.Log) {
    const ratio = pairedLogRatio(
      frame.pairs.map((p) => p.a),
      frame.pairs.map((p) => p.b),
    );
    if (!ratio) return null;
    const pct = (value: number) => (value - 1) * 100;
    return { observed: pct(ratio.ratio), lo: pct(ratio.ci.lo), hi: pct(ratio.ci.hi), degenerate: ratio.sdLog === 0 };
  }
  const meanA = average(frame.pairs.map((p) => p.a));
  if (meanA === 0) return null;
  const meanDifference = average(frame.differences);
  const sd = sampleSd(frame.differences) ?? 0;
  const half = tCritical95(frame.n - 1) * (sd / Math.sqrt(frame.n));
  const scale = 100 / Math.abs(meanA);
  return {
    observed: meanDifference * scale,
    lo: (meanDifference - half) * scale,
    hi: (meanDifference + half) * scale,
    degenerate: sd === 0,
  };
}

function magnitudeResult(frame: Frame): Comparison {
  const change = percentChange(frame);
  if (!change) {
    return directionResult(
      frame,
      " Magnitude is not expressible: the baseline mean is 0, so there is no percentage to take.",
    );
  }
  const direction = directionOf(average(frame.differences), frame.betterIs);
  const spansZero = change.lo <= 0 && change.hi >= 0;
  const ratio =
    frame.scale === MetricScale.Log ? ` (ratio of geometric means ${(1 + change.observed / 100).toFixed(2)})` : "";
  const core =
    `${frame.metric}observed ${formatSignedPercent(change.observed)}${ratio}, ` +
    `95% CI [${formatSignedPercent(change.lo)}, ${formatSignedPercent(change.hi)}], n=${frame.n}` +
    ` (${frame.labelB} against ${frame.labelA}, ${frame.betterIs} is better)`;
  const winner = direction === Direction.A ? frame.labelA : frame.labelB;
  const tail = spansZero ? ` — ${NO_DETECTABLE_DIFFERENCE}.` : `. Direction favours ${winner}.`;
  const degenerate = change.degenerate ? " No variance across pairs: the interval is degenerate, not precise." : "";
  return {
    kind: ComparisonKind.Magnitude,
    n: frame.n,
    pairs: frame.pairs,
    direction,
    observedPct: change.observed,
    ci95Pct: [change.lo, change.hi],
    spansZero,
    statement: `${core}${tail}${degenerate}`,
  };
}

/** Compare paired per-case values: one pair per distinct case, and `n` must agree with both arrays. */
export function compare(
  valuesA: readonly number[],
  valuesB: readonly number[],
  n: number,
  options: CompareOptions = {},
): Comparison {
  assertUsableSample(valuesA, valuesB, n);
  const pairs = valuesA.map((a, i) => ({ a, b: valuesB[i] }));
  const scale = options.scale ?? MetricScale.Linear;
  const frame: Frame = {
    metric: options.metric ? `${options.metric}: ` : "",
    labelA: options.labelA ?? Direction.A,
    labelB: options.labelB ?? Direction.B,
    betterIs: options.betterIs ?? BetterIs.Higher,
    scale,
    n,
    pairs,
    differences: [],
  };
  if (n < DIRECTION_FLOOR) return refused(frame, floorRefusal(n, "Raw pairs"));
  const logScale = scale === MetricScale.Log;
  if (logScale && pairs.some((p) => p.a <= 0 || p.b <= 0)) {
    return refused(
      frame,
      "the log scale needs positive values; a zero or negative value was measured. Raw pairs only.",
    );
  }
  frame.differences = pairs.map((p) => (logScale ? Math.log(p.b) - Math.log(p.a) : p.b - p.a));
  if (n < MAGNITUDE_FLOOR) return directionResult(frame);
  return magnitudeResult(frame);
}

/** The block a report prints: the statement, then the raw pairs, always. */
export function renderComparison(comparison: Comparison, options: CompareOptions = {}): string {
  const labelA = options.labelA ?? Direction.A;
  const labelB = options.labelB ?? Direction.B;
  const head = comparison.kind === ComparisonKind.Refused ? comparison.refusal : comparison.statement;
  const allIntegers = comparison.pairs.every((p) => Number.isInteger(p.a) && Number.isInteger(p.b));
  const show = (value: number) => (allIntegers ? String(value) : value.toFixed(2));
  const pairs = comparison.pairs.map((p) => `${show(p.a)} → ${show(p.b)}`).join(DOT);
  return `${head}\n  pairs (${labelA} → ${labelB}): ${pairs}`;
}

/** One run's value of a metric, tagged with its case. */
export interface CaseValue {
  caseId: string;
  value: number;
}

function caseMedians(values: readonly CaseValue[]): Map<string, number> {
  const byCase = new Map<string, number[]>();
  for (const { caseId, value } of values) byCase.set(caseId, [...(byCase.get(caseId) ?? []), value]);
  return new Map([...byCase].map(([caseId, list]) => [caseId, median(list) ?? Number.NaN]));
}

/** Collapse reps to per-case medians and pair the cases both arms ran, sorted by case id. */
export function pairByCase(
  armA: readonly CaseValue[],
  armB: readonly CaseValue[],
): { caseIds: string[]; a: number[]; b: number[] } {
  const a = caseMedians(armA);
  const b = caseMedians(armB);
  const caseIds = [...a.keys()].filter((caseId) => b.has(caseId)).sort();
  return {
    caseIds,
    a: caseIds.map((caseId) => a.get(caseId) ?? Number.NaN),
    b: caseIds.map((caseId) => b.get(caseId) ?? Number.NaN),
  };
}

/** Compare two arms across cases: n is the number of distinct cases both arms ran. */
export function compareCases(
  armA: readonly CaseValue[],
  armB: readonly CaseValue[],
  options: CompareOptions = {},
): Comparison {
  const paired = pairByCase(armA, armB);
  return compare(paired.a, paired.b, paired.caseIds.length, options);
}

/** One arm's passes of the runs that measured a rate. */
export interface RateTally {
  passes: number;
  runs: number;
}

/** One case's pass counts in both arms. */
export interface RateCase {
  caseId: string;
  a: RateTally;
  b: RateTally;
}

/**
 * A rate compared across cases (§10.2): n is the distinct cases both arms ran, under the same
 * floors as `compare`. At ≥ 8 cases it carries the Mantel–Haenszel odds ratio of B passing against
 * A stratified by case (null when no case is discordant the other way) and its RBG interval.
 */
export interface RateComparison {
  kind: ComparisonKind;
  n: number;
  cases: RateCase[];
  /** Pass counts pooled over the paired cases, each with its Wilson interval; null below the floor. */
  pooled: { a: RateTally & { interval: Interval }; b: RateTally & { interval: Interval } } | null;
  oddsRatio: number | null;
  ci95: Interval | null;
  direction: Direction;
  statement: string;
}

function rateTallies(values: readonly CaseValue[]): Map<string, RateTally> {
  const tallies = new Map<string, RateTally>();
  for (const { caseId, value } of values) {
    if (value !== 0 && value !== 1) throw new TypeError(`compareRateCases: a rate is 0 or 1 per run, got ${value}`);
    const tally = tallies.get(caseId) ?? { passes: 0, runs: 0 };
    tallies.set(caseId, { passes: tally.passes + value, runs: tally.runs + 1 });
  }
  return tallies;
}

/** The cases both arms ran, sorted by case id, with each arm's pass counts. */
function pairRateCases(armA: readonly CaseValue[], armB: readonly CaseValue[]): RateCase[] {
  const a = rateTallies(armA);
  const b = rateTallies(armB);
  return [...a.keys()]
    .filter((caseId) => b.has(caseId))
    .sort()
    .map((caseId) => ({
      caseId,
      a: a.get(caseId) ?? { passes: 0, runs: 0 },
      b: b.get(caseId) ?? { passes: 0, runs: 0 },
    }));
}

function pooledTally(cases: readonly RateCase[], arm: "a" | "b"): RateTally & { interval: Interval } {
  const passes = cases.reduce((sum, row) => sum + row[arm].passes, 0);
  const runs = cases.reduce((sum, row) => sum + row[arm].runs, 0);
  return { passes, runs, interval: wilson(passes, runs) };
}

/** "A 24/24 (100%, 95% CI 86–100%) · B 16/24 (67%, 95% CI 47–82%)". */
function pooledLine(pooled: NonNullable<RateComparison["pooled"]>, labelA: string, labelB: string): string {
  const show = (label: string, tally: RateTally & { interval: Interval }) =>
    `${label} ${tally.passes}/${tally.runs} (${formatPercent((tally.passes / tally.runs) * 100)}, ` +
    `95% CI ${Math.round(tally.interval.lo * 100)}–${formatPercent(tally.interval.hi * 100)})`;
  return `${show(labelA, pooled.a)}${DOT}${show(labelB, pooled.b)}`;
}

/** Whose pooled pass rate is better: the sign of B's rate minus A's, read through `betterIs`. */
function pooledDirection(pooled: NonNullable<RateComparison["pooled"]>, betterIs: BetterIs): Direction {
  return directionOf(pooled.b.passes / pooled.b.runs - pooled.a.passes / pooled.a.runs, betterIs);
}

/** The ≥ 8-case verdict: the odds ratio and whether its interval excludes 1, or why it has none. */
function rateMagnitude(
  frame: Pick<Frame, "metric" | "labelA" | "labelB" | "betterIs" | "n">,
  cases: readonly RateCase[],
  pooled: NonNullable<RateComparison["pooled"]>,
): Pick<RateComparison, "oddsRatio" | "ci95" | "direction" | "statement"> {
  // Orientation: a stratum's a·d over b·c is B's odds of passing over A's.
  const strata: Stratum[] = cases.map((row) => ({
    a: row.b.passes,
    b: row.b.runs - row.b.passes,
    c: row.a.passes,
    d: row.a.runs - row.a.passes,
  }));
  const { oddsRatio, ci } = mantelHaenszel(strata);
  const winner = (direction: Direction) => (direction === Direction.A ? frame.labelA : frame.labelB);
  const scope = `n=${frame.n} cases (${frame.labelB} passing against ${frame.labelA}, ${frame.betterIs} is better)`;
  if (oddsRatio === null || ci === null) {
    // No pooled ratio: a direction only when the arms' Wilson intervals do not overlap.
    const apart = pooled.a.interval.hi < pooled.b.interval.lo || pooled.b.interval.hi < pooled.a.interval.lo;
    const direction = apart ? pooledDirection(pooled, frame.betterIs) : Direction.None;
    const tail =
      direction === Direction.None ? ` — ${NO_DETECTABLE_DIFFERENCE}.` : `. Direction favours ${winner(direction)}.`;
    const why = "no case is discordant the other way";
    return {
      oddsRatio,
      ci95: null,
      direction,
      statement: `${frame.metric}Mantel–Haenszel odds ratio not estimable (${why}), ${scope}${tail}`,
    };
  }
  const direction = directionOf(Math.log(oddsRatio), frame.betterIs);
  const spansOne = ci.lo <= 1 && ci.hi >= 1;
  const core = `${frame.metric}Mantel–Haenszel odds ratio ${oddsRatio.toFixed(2)}, 95% CI [${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)}], ${scope}`;
  const tail = spansOne ? ` — ${NO_DETECTABLE_DIFFERENCE}.` : `. Direction favours ${winner(direction)}.`;
  return { oddsRatio, ci95: ci, direction, statement: `${core}${tail}` };
}

/**
 * Compare a rate across cases: each case's pass counts per arm (never a median of 0/1 values), n
 * the distinct cases both arms ran. Below 5 it refuses; 5–7 gives the pooled pass rates' direction;
 * ≥ 8 the Mantel–Haenszel odds ratio stratified by case, with a Wilson interval per arm.
 */
export function compareRateCases(
  armA: readonly CaseValue[],
  armB: readonly CaseValue[],
  options: CompareOptions = {},
): RateComparison {
  const cases = pairRateCases(armA, armB);
  const n = cases.length;
  const frame = {
    metric: options.metric ? `${options.metric}: ` : "",
    labelA: options.labelA ?? Direction.A,
    labelB: options.labelB ?? Direction.B,
    betterIs: options.betterIs ?? BetterIs.Higher,
    n,
  };
  const empty = { cases, n, oddsRatio: null, ci95: null };
  if (n < DIRECTION_FLOOR) {
    const statement = `${frame.metric}${floorRefusal(n, "Per-case pass counts")}`;
    return { ...empty, kind: ComparisonKind.Refused, pooled: null, direction: Direction.None, statement };
  }
  const pooled = { a: pooledTally(cases, "a"), b: pooledTally(cases, "b") };
  if (n >= MAGNITUDE_FLOOR)
    return { ...empty, kind: ComparisonKind.Magnitude, pooled, ...rateMagnitude(frame, cases, pooled) };
  const direction = pooledDirection(pooled, frame.betterIs);
  const head = `${frame.metric}n=${n} — direction may be claimed, magnitude may not.`;
  const winner = direction === Direction.A ? frame.labelA : frame.labelB;
  const body =
    direction === Direction.None
      ? `${NO_DETECTABLE_DIFFERENCE.charAt(0).toUpperCase()}${NO_DETECTABLE_DIFFERENCE.slice(1)}.`
      : `Direction favours ${winner} (pooled pass rate, ${frame.betterIs} is better). No magnitude at this n.`;
  return { ...empty, kind: ComparisonKind.Direction, pooled, direction, statement: `${head} ${body}` };
}

/** The block a report prints for a rate: the statement, the pooled Wilson rates, then every case's pass counts. */
export function renderRateComparison(comparison: RateComparison, options: CompareOptions = {}): string {
  const labelA = options.labelA ?? Direction.A;
  const labelB = options.labelB ?? Direction.B;
  const lines = [comparison.statement];
  if (comparison.pooled) lines.push(`  pooled: ${pooledLine(comparison.pooled, labelA, labelB)}`);
  const counts = (tally: RateTally) => `${tally.passes}/${tally.runs}`;
  const cases = comparison.cases.map((row) => `${counts(row.a)} → ${counts(row.b)}`).join(DOT);
  lines.push(`  cases (${labelA} → ${labelB}): ${cases}`);
  return lines.join("\n");
}

/** "8/8 clean is consistent with a failure rate as high as 31%": a clean sweep is never a checkmark. */
export function cleanSweepStatement(n: number): string {
  return `${n}/${n} clean is consistent with a failure rate as high as ${formatPercent(ruleOfThreeUpper(n) * 100)}`;
}

/** A sweep's pass count: the rule-of-three sentence when clean, else a Wilson interval. */
export function sweepStatement(passes: number, n: number): string {
  if (passes === n) return cleanSweepStatement(n);
  const { lo, hi } = wilson(passes, n);
  return (
    `${passes}/${n} passed — ${formatPercent((passes / n) * 100)}, ` +
    `95% CI [${formatPercent(lo * 100)}, ${formatPercent(hi * 100)}] (Wilson)`
  );
}
