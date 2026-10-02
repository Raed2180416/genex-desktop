/**
 * The total-break gate (`eval check`, §10.3). A cell (case × lane) is armed only when its base or
 * baseline boots with a Wilson 95% lower bound ≥ 0.5 over ≥ 6 runs (3 of 3 is not eligible: its
 * bound is 0.44). Harness-failure and void rows leave the count first, and unprobed runs are not
 * boot failures. Candidate attempts then walk a sequence: a first failure asks for one rerun; 2 of 2
 * failures is `probable` and asks for a third; 3 of 3 is `regression`; any pass beside any failure
 * is `flaky`, whichever came first (a campaign's planned reps are all measured, so a later failure
 * is never discarded), and an isolated retry never clears it. Each verdict prints its false-alarm probability
 * under the baseline lower bound and its detection probability for a halved pass rate, both for
 * that count rule over the attempts measured. Drift runs
 * only against a baseline of ≥ 8 runs, Mann–Whitney per primary with Holm, and is descriptive.
 */
import type { RunRow } from "../ledger/types.ts";
import { CHECK_EXIT_CODE, CheckState } from "../vocabulary.ts";
import { DOT, formatPercent } from "./compare.ts";
import { adjustPrimaries, bootOutcome, countsInN, formatMetricValue, type MetricId } from "./endpoints.ts";
import { brunnerMunzel, mannWhitney, median, wilson } from "./stats.ts";

/** A cell is armed only with at least this many baseline runs. */
export const GATE_MIN_BASELINE_RUNS = 6;
/** …and a baseline Wilson 95% lower bound at least this high. */
export const GATE_MIN_LOWER_BOUND = 0.5;
/** Candidate attempts before a verdict is final: the first run plus two reruns. */
export const GATE_MAX_ATTEMPTS = 3;
/** Drift is computed only against a baseline cell of at least this many runs. */
export const DRIFT_MIN_BASELINE_RUNS = 8;

/** How bad each state is, so the worst cell decides the exit code. */
const SEVERITY: Record<CheckState, number> = {
  [CheckState.Clear]: 0,
  [CheckState.Flaky]: 1,
  [CheckState.Probable]: 2,
  [CheckState.Regression]: 3,
};

/** Whether a cell's baseline can arm the gate. */
export interface GateEligibility {
  eligible: boolean;
  runs: number;
  passes: number;
  /** The Wilson 95% lower bound of the baseline boot rate; null with no runs. */
  lowerBound: number | null;
  /** The baseline point estimate; null with no runs. */
  passRate: number | null;
}

/** Eligibility from baseline boot outcomes (1 booted, 0 failed); unprobed (null) runs are left out. */
export function gateEligibility(baselineBoots: readonly (number | null)[]): GateEligibility {
  const measured = baselineBoots.filter((value): value is number => value !== null);
  const passes = measured.filter((value) => value === 1).length;
  const runs = measured.length;
  if (runs === 0) return { eligible: false, runs, passes, lowerBound: null, passRate: null };
  const lowerBound = wilson(passes, runs).lo;
  const eligible = runs >= GATE_MIN_BASELINE_RUNS && lowerBound >= GATE_MIN_LOWER_BOUND;
  return { eligible, runs, passes, lowerBound, passRate: passes / runs };
}

/** Where the attempt sequence stands: a state once one is reached, and whether another rerun is due. */
export interface GateStep {
  state: CheckState | null;
  rerun: boolean;
}

/**
 * Advance the gate over the candidate's attempts (true = booted). It decides from counts, not the
 * first attempt: clear only when every attempt booted, flaky when a pass sits beside a failure in
 * any order, and the failure ladder (rerun, probable, regression) when none booted.
 */
export function gateStep(attempts: readonly boolean[], maxAttempts = GATE_MAX_ATTEMPTS): GateStep {
  if (attempts.length === 0) return { state: null, rerun: true };
  if (attempts.every((booted) => booted)) return { state: CheckState.Clear, rerun: false };
  if (attempts.some((booted) => booted)) return { state: CheckState.Flaky, rerun: false };
  const failures = attempts.length;
  if (failures === 1) return { state: null, rerun: maxAttempts > 1 };
  if (failures < maxAttempts) return { state: CheckState.Probable, rerun: true };
  return { state: failures >= GATE_MAX_ATTEMPTS ? CheckState.Regression : CheckState.Probable, rerun: false };
}

/**
 * The probability that a candidate with boot rate `passRate` reaches at least `state` (clear: null)
 * under `gateStep`'s count rule over `attempts` measured runs (fewer count as the state's own
 * minimum): any failure among them is at least flaky (1 − p^n), and all failing is probable or
 * regression ((1 − p)^n). When later attempts exist only after a failure (a pure rerun), 1 − p^n
 * overstates the flaky false alarm, which errs on the cautious side.
 */
export function reachProbability(state: CheckState, passRate: number, attempts = 0): number | null {
  const fail = 1 - passRate;
  if (state === CheckState.Regression) return fail ** Math.max(attempts, GATE_MAX_ATTEMPTS);
  if (state === CheckState.Probable) return fail ** Math.max(attempts, 2);
  if (state === CheckState.Flaky) return 1 - passRate ** Math.max(attempts, 1);
  return null;
}

/** One cell's verdict. */
export interface CellCheck {
  caseId: string;
  laneId: string;
  eligibility: GateEligibility;
  /** False when the baseline cannot arm the gate: the cell is clear and says why. */
  armed: boolean;
  attempts: boolean[];
  /** Null while a first failure waits for its rerun; `checkOutcome` counts that as `flaky`, never `clear`. */
  state: CheckState | null;
  rerun: boolean;
  /** The state the operating characteristics are printed for: the reached state, or `regression` when clear. */
  characterised: CheckState;
  falseAlarm: number | null;
  detection: number | null;
  /** Candidate rows left out: harness failures, void rows and unprobed runs. */
  excluded: number;
}

/** A cell's inputs as values: baseline and candidate boot outcomes in attempt order. */
export interface CellValues {
  caseId: string;
  laneId: string;
  baselineBoots: readonly (number | null)[];
  candidateBoots: readonly (number | null)[];
  excluded?: number;
}

/** The verdict for one cell. */
export function checkCell(values: CellValues): CellCheck {
  const eligibility = gateEligibility(values.baselineBoots);
  const attempts = values.candidateBoots.filter((value): value is number => value !== null).map((value) => value === 1);
  const unprobed = values.candidateBoots.length - attempts.length;
  const step = eligibility.eligible ? gateStep(attempts) : { state: CheckState.Clear, rerun: false };
  const state = step.state;
  const settledClear = state === null || state === CheckState.Clear;
  const characterised = settledClear ? CheckState.Regression : state;
  const lowerBound = eligibility.lowerBound;
  const passRate = eligibility.passRate;
  return {
    caseId: values.caseId,
    laneId: values.laneId,
    eligibility,
    armed: eligibility.eligible,
    attempts,
    state,
    rerun: step.rerun,
    characterised,
    falseAlarm: lowerBound === null ? null : reachProbability(characterised, lowerBound, attempts.length),
    detection: passRate === null ? null : reachProbability(characterised, passRate / 2, attempts.length),
    excluded: (values.excluded ?? 0) + unprobed,
  };
}

/** The verdict for one cell from ledger rows; candidate attempts are ordered by `recordedAt`. */
export function checkCellRows(
  caseId: string,
  laneId: string,
  baseline: readonly RunRow[],
  candidate: readonly RunRow[],
) {
  return checkCellAgainst(caseId, laneId, baseline.filter(countsInN).map(bootOutcome), candidate);
}

/**
 * The verdict for one cell from baseline boot outcomes (a committed baseline's raw values, or the
 * base's rows) and the candidate's ledger rows, ordered by `recordedAt`.
 */
export function checkCellAgainst(
  caseId: string,
  laneId: string,
  baselineBoots: readonly (number | null)[],
  candidate: readonly RunRow[],
) {
  const ordered = [...candidate].sort((x, y) => x.recordedAt.localeCompare(y.recordedAt));
  const counted = ordered.filter(countsInN);
  return checkCell({
    caseId,
    laneId,
    baselineBoots,
    candidateBoots: counted.map(bootOutcome),
    excluded: ordered.length - counted.length,
  });
}

/** The worst state across cells and its exit code (0 clear, 4 flaky, 3 probable, 2 regression); a pending cell counts as flaky. */
export function checkOutcome(cells: readonly CellCheck[]): { state: CheckState; exitCode: number } {
  const state = cells.reduce<CheckState>((worst, cell) => {
    const own = cell.state ?? CheckState.Flaky;
    return SEVERITY[own] > SEVERITY[worst] ? own : worst;
  }, CheckState.Clear);
  return { state, exitCode: CHECK_EXIT_CODE[state] };
}

function probability(value: number | null): string {
  return value === null ? "not computable" : formatPercent(value * 100);
}

function eligibilityText(eligibility: GateEligibility): string {
  const bound =
    eligibility.lowerBound === null ? "no baseline runs" : `Wilson LB ${formatPercent(eligibility.lowerBound * 100)}`;
  return `baseline ${eligibility.passes}/${eligibility.runs} booted, ${bound}`;
}

/** One cell as a line: the state, the attempts, and its operating characteristics. */
export function renderCell(cell: CellCheck): string {
  const head = `${cell.caseId} × ${cell.laneId}`;
  if (!cell.armed) {
    const need = `needs ≥${GATE_MIN_BASELINE_RUNS} runs and LB ≥ ${formatPercent(GATE_MIN_LOWER_BOUND * 100)}`;
    return `${head}: clear — gate not armed (${eligibilityText(cell.eligibility)}; ${need})`;
  }
  const attempts = cell.attempts.map((booted) => (booted ? "boot" : "no boot")).join(", ") || "none yet";
  const rerun = cell.rerun ? `${DOT}rerun due` : "";
  const odds =
    `P(${cell.characterised} | healthy at baseline LB) ${probability(cell.falseAlarm)}; ` +
    `P(${cell.characterised} | boot rate halved) ${probability(cell.detection)}`;
  return `${head}: ${cell.state ?? "pending"}${rerun}${DOT}attempts: ${attempts}${DOT}${eligibilityText(cell.eligibility)}${DOT}${odds}${DOT}excluded ${cell.excluded}`;
}

/** One primary metric's baseline and candidate values for drift. */
export interface DriftInput {
  metric: MetricId;
  baseline: readonly number[];
  candidate: readonly number[];
}

/** Drift for one primary: too small, or descriptive rank tests with the Holm-adjusted p. */
export type DriftResult =
  | { metric: MetricId; tooSmall: true; baselineRuns: number; baseline: number[]; candidate: number[] }
  | { metric: MetricId; tooSmall: false; p: number; adjusted: number; brunnerMunzelP: number | null };

/** Drift on the primaries: only for baselines of ≥ 8 runs; Mann–Whitney per metric, Holm across the computed ones. */
export function drift(inputs: readonly DriftInput[]): DriftResult[] {
  const computable = inputs
    .filter((input) => input.baseline.length >= DRIFT_MIN_BASELINE_RUNS)
    .map((input) => ({ input, test: mannWhitney(input.baseline, input.candidate) }))
    .filter((entry) => entry.test !== null);
  const adjusted = adjustPrimaries(computable.map(({ input, test }) => ({ metric: input.metric, p: test?.p ?? 1 })));
  return inputs.map((input) => {
    const index = computable.findIndex((entry) => entry.input === input);
    if (index < 0) {
      const values = { baseline: [...input.baseline], candidate: [...input.candidate] };
      return { metric: input.metric, tooSmall: true, baselineRuns: input.baseline.length, ...values };
    }
    const bm = brunnerMunzel(input.baseline, input.candidate);
    return {
      metric: input.metric,
      tooSmall: false,
      p: adjusted[index].p,
      adjusted: adjusted[index].adjusted,
      brunnerMunzelP: bm?.p ?? null,
    };
  });
}

/** Drift as lines; below the floor it says so and shows the values side by side. */
export function renderDrift(results: readonly DriftResult[]): string {
  return results
    .map((result) => {
      if (result.tooSmall) {
        const side = (values: readonly number[]) =>
          values.map((v) => formatMetricValue(result.metric, v)).join(", ") || "none";
        return `${result.metric}: baseline too small for drift (n=${result.baselineRuns})${DOT}baseline: ${side(result.baseline)}${DOT}candidate: ${side(result.candidate)}`;
      }
      const bm = result.brunnerMunzelP === null ? "" : `${DOT}Brunner–Munzel p=${result.brunnerMunzelP.toFixed(3)}`;
      return `${result.metric}: Mann–Whitney p=${result.p.toFixed(3)}, Holm ${result.adjusted.toFixed(3)}${bm} (descriptive drift)`;
    })
    .join("\n");
}

/** The whole check report: one line per cell, then the verdict and its exit code. */
export function renderCheck(cells: readonly CellCheck[], driftResults: readonly DriftResult[] = []): string {
  const outcome = checkOutcome(cells);
  const lines = cells.map(renderCell);
  if (driftResults.length > 0) lines.push("Drift (primaries)", renderDrift(driftResults));
  const medianAttempts = median(cells.map((cell) => cell.attempts.length));
  lines.push(
    `verdict: ${outcome.state} (exit ${outcome.exitCode})${DOT}median attempts per cell ${medianAttempts ?? "none"}`,
  );
  return lines.join("\n");
}
