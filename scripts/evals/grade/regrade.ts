/**
 * Regrading (§10.6, Rule 10): a new `gradeSeq` of a run already observed, never a new observation.
 * The collected row is copied whole; only the grade changes. When the retained grade was probed by
 * the current prober, its scan and final probe are reused and only the checklist is asked again
 * (a grader bump); otherwise, or when asked, the retained snapshots are served and probed again (a
 * prober bump). `--baseline` regrades every run a committed baseline names, which a grader or
 * prober bump requires before any comparison against it.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { BudgetStop } from "../budget.ts";
import { currentRows, readRunRows } from "../ledger/read.ts";
import type { RunRow } from "../ledger/types.ts";
import { parseBaseline } from "../report/baseline.ts";
import {
  caseForRow,
  calibrationRefusal,
  type GradeRecord,
  type GradeRefusal,
  GradeSkip,
  type GradingDeps,
  gradeRun,
  nextGradeSeq,
  readGradeRecord,
  vendorDirFor,
  vendorRefusal,
} from "./pipeline.ts";

/** Where committed baselines live, relative to the repository root (§10.4). */
export const BASELINES_DIR = "evals/baselines";

/** Why one run could not be regraded (besides a calibration refusal). */
export const RegradeRefusal = {
  /** The ledger holds no row for this run id. */
  RunUnknown: "run-unknown",
  /** The run's case is not in the case files. */
  CaseUnknown: "case-unknown",
  /** The run's case changed since it ran, so its checklist is not the one the run was given. */
  CaseChanged: "case-changed",
  /** A Genex run to probe again whose app build (its `/vendor`) is missing. */
  AppBuildMissing: "app-build-missing",
} as const;
export type RegradeRefusal = (typeof RegradeRefusal)[keyof typeof RegradeRefusal];

/** The regrade refusal for a case the grade pipeline would skip. */
const CASE_REFUSAL: Partial<Record<GradeSkip, RegradeRefusal>> = {
  [GradeSkip.CaseUnknown]: RegradeRefusal.CaseUnknown,
  [GradeSkip.CaseChanged]: RegradeRefusal.CaseChanged,
};

/** How a regrade is asked. */
export interface RegradeOptions {
  /** Serve and probe the retained snapshots again even when the retained probe is current. */
  reprobe?: boolean;
}

/** What regrading one run did. */
export interface RegradeOutcome {
  runId: string;
  refused: GradeRefusal | RegradeRefusal | null;
  /** The new grade's sequence, or null when nothing was written. */
  gradeSeq: number | null;
  /** Whether the snapshots were probed again (false: the retained probe was reused). */
  reprobed: boolean;
  stop: BudgetStop | null;
}

/**
 * The retained record a regrade may reuse: the current grade's, probed by this prober version and by
 * the same prober kind (a quick probe is never reused for a full grade, nor a full one for a quick).
 */
async function reusable(row: RunRow, deps: GradingDeps, options: RegradeOptions): Promise<GradeRecord | null> {
  if (options.reprobe || row.checklist === null) return null;
  const record = await readGradeRecord(deps.paths, row.runId, row.gradeSeq);
  if (record?.proberVersion !== deps.proberVersion) return null;
  const sameKind = record.probe === null || record.probe.quick === deps.quick;
  return sameKind ? record : null;
}

/** The outcome of a regrade that wrote nothing. */
function refusedOutcome(runId: string, refused: RegradeOutcome["refused"], stop: BudgetStop | null = null) {
  return { runId, refused, gradeSeq: null, reprobed: false, stop };
}

/** Regrade one run, after the calibration gate, under the probe lock and the quota guard. */
export async function regradeRun(
  runId: string,
  deps: GradingDeps,
  options: RegradeOptions = {},
): Promise<RegradeOutcome> {
  const refusal = (await calibrationRefusal(deps)) ?? (await vendorRefusal(deps));
  if (refusal !== null) return refusedOutcome(runId, refusal);
  const rows = (await readRunRows(deps.paths)).filter((row) => row.runId === runId);
  const [current] = currentRows(rows);
  if (!current) return refusedOutcome(runId, RegradeRefusal.RunUnknown);
  const evalCase = caseForRow(current, deps.cases);
  if (typeof evalCase === "string") return refusedOutcome(runId, CASE_REFUSAL[evalCase] ?? RegradeRefusal.CaseUnknown);
  return deps.withLock(async () => {
    const stop = await deps.quotaGate();
    if (stop !== null) return refusedOutcome(runId, null, stop);
    const reuse = await reusable(current, deps, options);
    // Only a run probed again is served; a reused probe needs no vendor folder.
    const vendorDir = reuse === null ? await vendorDirFor(current, deps) : deps.vendorDir;
    if (vendorDir === null) return refusedOutcome(runId, RegradeRefusal.AppBuildMissing);
    const gradeSeq = nextGradeSeq(rows, runId);
    await gradeRun(current, evalCase, gradeSeq, { ...deps, vendorDir }, reuse);
    return { runId, refused: null, gradeSeq, reprobed: reuse === null, stop: null };
  });
}

/** Every run id the committed baselines under `root` reference, in file order, each once. */
export async function baselineRunIds(root: string): Promise<string[]> {
  const dir = path.join(root, BASELINES_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  const ids: string[] = [];
  for (const name of names.filter((file) => file.endsWith(".json")).sort()) {
    const baseline = parseBaseline(await readFile(path.join(dir, name), "utf8"));
    for (const lane of baseline.lanes) ids.push(...lane.runIds);
  }
  return [...new Set(ids)];
}

/** Regrade every run the committed baselines reference, one at a time; stops at the quota guard. */
export async function regradeBaseline(
  root: string,
  deps: GradingDeps,
  options: RegradeOptions = {},
): Promise<RegradeOutcome[]> {
  const outcomes: RegradeOutcome[] = [];
  for (const runId of await baselineRunIds(root)) {
    const outcome = await regradeRun(runId, deps, options);
    outcomes.push(outcome);
    if (outcome.stop !== null) break;
  }
  return outcomes;
}
