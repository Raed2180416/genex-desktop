/**
 * `check <campaign> [--baseline]` (§10.3): the total-break gate over a campaign's candidate runs,
 * cell by cell (case × lane). The preferred base is the same campaign's base app (`--apps
 * base,cand`, interleaved per rep); without one, or with `--baseline`, it is the committed
 * baseline's raw boot values for the cell, used only when the baseline's case version, endpoints
 * and pins outside the version axis match the candidate's rows: otherwise the cell stays unarmed,
 * the refusal names the field, and a verdict that would be clear exits 1 instead. Drift is printed
 * for cells whose base has ≥ 8 runs. The
 * Diagnostics block prints first, before any baseline refusal and the cell verdicts: while a
 * diagnostic is red a `clear` verdict is withheld (exit 1, its line printed last), and a failing
 * verdict keeps its own code. Exit codes are `CHECK_EXIT_CODE` (clear 0, regression 2,
 * probable 3, flaky 4); 1 is a refusal (no candidate runs, withheld), 64 bad usage.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppRole, type PlannedApp } from "../campaign/types.ts";
import { readCampaignPlan } from "../campaign/plan.ts";
import { BASELINES_DIR } from "../grade/regrade.ts";
import { isMeasured, type RunRow } from "../ledger/types.ts";
import { type BaselineFile, baselineFault, baselineLaneRefusal, parseBaseline } from "../report/baseline.ts";
import {
  type CellCheck,
  checkCellAgainst,
  checkOutcome,
  DRIFT_MIN_BASELINE_RUNS,
  drift,
  renderCheck,
  renderDrift,
} from "../report/check.ts";
import { countsInN, METRICS, MetricId } from "../report/endpoints.ts";
import { CheckState, RowKind } from "../vocabulary.ts";
import { campaignIdOf, parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { campaignHealth, printDiagnostics } from "./diagnostics.ts";
import { CliExit, type Out } from "./exit.ts";

const MESSAGE = {
  usage: "usage: check <campaign> [--baseline]",
  noCandidates: "refused no-candidate-runs",
  withheld: "verdict withheld: diagnostics red",
  drift: "Drift",
  badBaseline: "refused baseline",
  staleBaseline: "verdict withheld: a committed baseline was refused",
} as const;

const BASELINE_FLAG = "--baseline";
/** The primaries drift is computed on (§7.1). */
const DRIFT_METRICS: readonly MetricId[] = [MetricId.BootRate, MetricId.ScoreAllRuns];

/** One cell's base: raw values per primary, oldest first. */
type CellBase = Map<MetricId, (number | null)[]>;

/** A cell's key. */
const cellKey = (caseId: string, laneId: string) => `${caseId} × ${laneId}`;

/** The rows of one app build (by its full sha); every row when `app` is null. */
function ofApp(rows: readonly RunRow[], app: PlannedApp | null): RunRow[] {
  if (app === null) return [...rows];
  return rows.filter((row) => isMeasured(row.pins.run.appSha) && row.pins.run.appSha === app.sha);
}

/** Base values per cell from the base app's rows in the same campaign. */
function basesFromRows(rows: readonly RunRow[]): Map<string, CellBase> {
  const bases = new Map<string, CellBase>();
  for (const row of rows.filter(countsInN)) {
    const key = cellKey(row.case.id, row.lane.id);
    const base = bases.get(key) ?? new Map<MetricId, (number | null)[]>();
    for (const metric of DRIFT_METRICS)
      base.set(metric, [...(base.get(metric) ?? []), METRICS[metric].read?.(row) ?? null]);
    bases.set(key, base);
  }
  return bases;
}

/** Cell bases, and a refusal line per committed baseline lane that may not be one. */
interface GateBases {
  bases: Map<string, CellBase>;
  refusals: string[];
}

/**
 * Base values per cell from the committed baselines of the candidate's cases; a lane measured
 * under other pins than the candidate's rows of its cell is refused and leaves that cell unarmed.
 */
async function basesFromBaselines(root: string, candidate: readonly RunRow[]): Promise<GateBases> {
  const found: GateBases = { bases: new Map(), refusals: [] };
  for (const caseId of [...new Set(candidate.map((row) => row.case.id))]) {
    const text = await readFile(path.join(root, BASELINES_DIR, `${caseId}.json`), "utf8").catch(() => null);
    if (text === null) continue;
    const baseline: BaselineFile = parseBaseline(text);
    for (const lane of baseline.lanes) {
      const key = cellKey(caseId, lane.laneId);
      const rows = candidate.filter((row) => cellKey(row.case.id, row.lane.id) === key);
      const refusal = baselineLaneRefusal(baseline, lane, rows);
      if (refusal !== null) {
        found.refusals.push(`${MESSAGE.badBaseline} ${key}: ${refusal}`);
        continue;
      }
      found.bases.set(key, new Map(DRIFT_METRICS.map((m) => [m, lane.metrics[m] ?? []])));
    }
  }
  return found;
}

/** The candidate's cells, each checked against its base (an unknown base leaves the gate unarmed). */
function checkCells(candidate: readonly RunRow[], bases: Map<string, CellBase>): CellCheck[] {
  const byCell = new Map<string, RunRow[]>();
  for (const row of candidate) {
    const key = cellKey(row.case.id, row.lane.id);
    byCell.set(key, [...(byCell.get(key) ?? []), row]);
  }
  return [...byCell]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const boots = bases.get(key)?.get(MetricId.BootRate) ?? [];
      return checkCellAgainst(rows[0].case.id, rows[0].lane.id, boots, rows);
    });
}

/** Drift lines for every cell whose base has enough runs. */
function driftLines(candidate: readonly RunRow[], bases: Map<string, CellBase>): string[] {
  const lines: string[] = [];
  for (const [key, base] of [...bases].sort(([a], [b]) => a.localeCompare(b))) {
    const baseRuns = base.get(MetricId.BootRate)?.length ?? 0;
    if (baseRuns < DRIFT_MIN_BASELINE_RUNS) continue;
    const cellRows = candidate.filter((row) => cellKey(row.case.id, row.lane.id) === key && countsInN(row));
    const measured = (values: readonly (number | null)[]) => values.filter((v): v is number => v !== null);
    const inputs = DRIFT_METRICS.map((metric) => ({
      metric,
      baseline: measured(base.get(metric) ?? []),
      candidate: measured(cellRows.map((row) => METRICS[metric].read?.(row) ?? null)),
    }));
    lines.push(`${MESSAGE.drift} ${key}`, renderDrift(drift(inputs)));
  }
  return lines;
}

/** The candidate rows and the bases they are checked against. */
async function gateInputs(ctx: CliContext, campaignId: string, rows: readonly RunRow[], useBaseline: boolean) {
  const plan = await readCampaignPlan(ctx.paths, campaignId).catch(() => null);
  const base = plan?.apps.find((app) => app.role === AppRole.Base) ?? null;
  const cand = plan?.apps.find((app) => app.role === AppRole.Candidate) ?? null;
  const builds = rows.filter((row) => row.kind === RowKind.Build);
  const candidate = ofApp(builds, cand);
  if (!useBaseline && base !== null && cand !== null)
    return { candidate, bases: basesFromRows(ofApp(builds, base)), refusals: [] };
  return { candidate, ...(await basesFromBaselines(ctx.root, candidate)) };
}

/** The `check` command handler. */
export async function checkCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  const parsed = parseCliArgs(args, { switches: [BASELINE_FLAG] });
  const campaignId = campaignIdOf(parsed);
  if (campaignId === null) {
    out(MESSAGE.usage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  const { rows, block } = await campaignHealth(ctx.paths, campaignId);
  let inputs: Awaited<ReturnType<typeof gateInputs>>;
  try {
    inputs = await gateInputs(ctx, campaignId, rows, parsed?.switches.has(BASELINE_FLAG) === true);
  } catch (error) {
    const field = baselineFault(error);
    if (field === null) throw error;
    out(`${MESSAGE.badBaseline} ${field}`);
    return CliExit.Refused;
  }
  const { candidate, bases, refusals } = inputs;
  if (candidate.length === 0) {
    out(`${MESSAGE.noCandidates} ${campaignId}`);
    return CliExit.Refused;
  }
  const cells = checkCells(candidate, bases);
  // The block comes before any claim: a reader sees a red diagnostic before the verdicts it qualifies.
  printDiagnostics(block, out);
  for (const line of refusals) out(line);
  for (const line of [renderCheck(cells), ...driftLines(candidate, bases)].join("\n").split("\n")) out(line);
  const outcome = checkOutcome(cells);
  if (outcome.state === CheckState.Clear && block.blocking.length > 0) {
    out(`${MESSAGE.withheld} (${block.blocking.join(", ")})`);
    return CliExit.Refused;
  }
  // A stale baseline left its cell unarmed: that cell's clear is no verdict, so it never exits 0.
  if (outcome.state === CheckState.Clear && refusals.length > 0) {
    out(MESSAGE.staleBaseline);
    return CliExit.Refused;
  }
  return outcome.exitCode;
}
