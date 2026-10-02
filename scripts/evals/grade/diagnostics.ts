/**
 * Eval-health diagnostics (§10.7), run before any claim and printed as a **Diagnostics** block by
 * `report`, `check` and `baseline promote`; a red one blocks promotion. Each is a pure function
 * over ledger rows or the grades' item verdicts:
 *
 * - **grader repeatability:** a seeded sample (10%, at least 5) of graded items is graded again with
 *   the same pins; disagreement per family above 10% is red. The re-grade itself goes through the
 *   injected grader (`runRepeatabilitySample`), so the arithmetic stays pure;
 * - **plumbing:** harness failures, truncated or unparsed traces and API errors above 5% of a cell
 *   are red — infrastructure noise masquerades as model variance;
 * - **headroom:** a case whose primary is ≥ 95% for every lane is `saturated`;
 * - **always-failing items:** an item that fails in every run of every lane (≥ 6 runs) is a
 *   `suspect-item` for the owner, never dropped;
 * - **noise floor:** the observed MDE against the owner's `minActionableDelta`; at or above it the
 *   report says "more reps or cases needed" instead of a verdict;
 * - **scaling sanity:** an effort-low twin must not score higher than its lane.
 */
import type { EngineId } from "../../../src/shared/providers.ts";
import type { AcceptanceItem, EvalCase } from "../case-types.ts";
import { caseById } from "../cases.ts";
import type { FamilyVerdicts, RunRow } from "../ledger/types.ts";
import { countsInN, ENDPOINTS, METRICS, type MetricId } from "../report/endpoints.ts";
import { mean, minimumDetectableDifference, seededRandom } from "../report/stats.ts";
import { Axis, Effort, type GraderFamily, ItemVerdict, RowKind } from "../vocabulary.ts";
import type { GradeRecord } from "./pipeline.ts";
import type { EvidenceRefs, GradeChecklist, GraderPin } from "./types.ts";

/** The share of graded items re-graded for repeatability. */
export const REPEATABILITY_SAMPLE_SHARE = 0.1;
/** The fewest items a repeatability sample holds (all of them when fewer exist). */
export const REPEATABILITY_MIN_SAMPLE = 5;
/** Disagreement above this share, in any family, is red. */
export const REPEATABILITY_MAX_DISAGREEMENT = 0.1;
/** Plumbing noise above this share of a cell is red. */
export const PLUMBING_MAX_SHARE = 0.05;
/** A primary at or above this for every lane saturates the case. */
export const HEADROOM_SATURATED = 0.95;
/** An item needs this many runs before "fails everywhere" means anything. */
export const ALWAYS_FAILING_MIN_RUNS = 6;

/** The diagnostics, in the order the block prints them. */
export const DiagnosticId = {
  GraderRepeatability: "grader-repeatability",
  Plumbing: "plumbing",
  Headroom: "headroom",
  AlwaysFailingItems: "always-failing-items",
  NoiseFloor: "noise-floor",
  ScalingSanity: "scaling-sanity",
} as const;
export type DiagnosticId = (typeof DiagnosticId)[keyof typeof DiagnosticId];

/** A diagnostic's state: green, a flag for the owner, red (blocks promotion), or nothing to judge. */
export const DiagnosticStatus = {
  Ok: "ok",
  Warn: "warn",
  Block: "block",
  NotRun: "not-run",
} as const;
export type DiagnosticStatus = (typeof DiagnosticStatus)[keyof typeof DiagnosticStatus];

/** What a finding says about its subject. */
export const DiagnosticFlag = {
  GraderUnrepeatable: "grader-unrepeatable",
  PlumbingNoise: "plumbing-noise",
  Saturated: "saturated",
  SuspectItem: "suspect-item",
  MoreDataNeeded: "more-data-needed",
  ScalingInverted: "scaling-inverted",
} as const;
export type DiagnosticFlag = (typeof DiagnosticFlag)[keyof typeof DiagnosticFlag];

/** The sentence each flag prints beside its numbers. */
const FLAG_TEXT: Readonly<Record<DiagnosticFlag, string>> = {
  [DiagnosticFlag.GraderUnrepeatable]: "grader disagrees with itself on identical evidence",
  [DiagnosticFlag.PlumbingNoise]: "timeouts, API errors, truncated traces or harness failures",
  [DiagnosticFlag.Saturated]: "saturated: rotate the case or move its objective to cost or latency",
  [DiagnosticFlag.SuspectItem]: "fails in every run of every lane: review its wording or its grader",
  [DiagnosticFlag.MoreDataNeeded]: "more reps or cases needed: noise is at or above the smallest actionable change",
  [DiagnosticFlag.ScalingInverted]: "scores higher at lower effort: check the case or the grader",
};

/** One flagged subject: a family, a cell, a case, an item or an axis, with its number and threshold. */
export interface DiagnosticFinding {
  subject: string;
  flag: DiagnosticFlag;
  value: number | null;
  threshold: number;
  /** How many units the value was computed over. */
  n: number;
}

/** One diagnostic's verdict. */
export interface Diagnostic {
  id: DiagnosticId;
  status: DiagnosticStatus;
  findings: DiagnosticFinding[];
}

/** The Diagnostics block: every diagnostic, the red ones, and the ones with nothing to judge. */
export interface Diagnostics {
  diagnostics: Diagnostic[];
  /** Red diagnostics: promotion is blocked while any is listed. */
  blocking: DiagnosticId[];
  notRun: DiagnosticId[];
}

/** One graded checklist item of one run, as a grade record holds it. */
export interface ItemRecord {
  runId: string;
  caseId: string;
  laneId: string;
  runEngine: EngineId;
  item: AcceptanceItem;
  combined: ItemVerdict;
  verdicts: FamilyVerdicts;
  /** What the grader saw, so the item can be graded again on identical evidence. */
  evidence: EvidenceRefs;
}

/** One family's verdict on one item, first and again. */
export interface RepeatabilityObservation {
  runId: string;
  itemId: string;
  family: GraderFamily;
  first: ItemVerdict;
  again: ItemVerdict;
}

/** A diagnostic from its findings: red or flagged when any, green otherwise. */
function verdict(id: DiagnosticId, findings: DiagnosticFinding[], flagged: DiagnosticStatus): Diagnostic {
  return { id, status: findings.length > 0 ? flagged : DiagnosticStatus.Ok, findings };
}

const notRun = (id: DiagnosticId): Diagnostic => ({ id, status: DiagnosticStatus.NotRun, findings: [] });

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

const cellOf = (row: RunRow): string => `${row.case.id} × ${row.lane.id}`;

/** The graded items of one run's grade record. */
export function itemRecordsOf(row: RunRow, record: GradeRecord): ItemRecord[] {
  const evidence = record.probe?.evidence;
  if (!evidence) return [];
  return record.checklist.items.map((entry) => ({
    runId: row.runId,
    caseId: row.case.id,
    laneId: row.lane.id,
    runEngine: row.lane.engine,
    item: entry.item,
    combined: entry.combined,
    verdicts: entry.verdicts,
    evidence,
  }));
}

/** A seeded repeatability sample: 10% of the items, at least five (all of them when fewer). */
export function sampleForRepeatability(items: readonly ItemRecord[], seed: string): ItemRecord[] {
  const size = Math.min(
    items.length,
    Math.max(REPEATABILITY_MIN_SAMPLE, Math.ceil(items.length * REPEATABILITY_SAMPLE_SHARE)),
  );
  const random = seededRandom(seed);
  const order = items.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] ?? i, order[i] ?? j];
  }
  const chosen = new Set(order.slice(0, size));
  return items.filter((_, index) => chosen.has(index));
}

/** Grade one sampled item again with the same pins; answers each family's verdict. */
export type ItemRegrader = (target: ItemRecord) => Promise<FamilyVerdicts>;

/** Re-grade a sample one item at a time and pair each family's first and second verdict. */
export async function runRepeatabilitySample(
  sample: readonly ItemRecord[],
  regrade: ItemRegrader,
): Promise<RepeatabilityObservation[]> {
  const observations: RepeatabilityObservation[] = [];
  for (const target of sample) {
    const again = await regrade(target);
    for (const [family, first] of Object.entries(target.verdicts) as Array<[GraderFamily, ItemVerdict]>) {
      const second = again[family];
      if (second === undefined) continue;
      observations.push({ runId: target.runId, itemId: target.item.id, family, first, again: second });
    }
  }
  return observations;
}

/** What re-grading one item needs: the checklist grader, its pins and the cases. */
export interface ItemRegraderDeps {
  gradeChecklist: GradeChecklist;
  graders: GraderPin[];
  votesPerFamily: number;
  cases: readonly EvalCase[];
}

/** The injected checklist grader bound to one item: the same case, evidence and pins, that item alone. */
export function checklistItemRegrader(deps: ItemRegraderDeps): ItemRegrader {
  return async (target) => {
    const evalCase = caseById(deps.cases, target.caseId);
    if (!evalCase) return {};
    const result = await deps.gradeChecklist({
      evalCase: { ...evalCase, acceptance: [target.item] },
      evidence: target.evidence,
      graders: deps.graders,
      votesPerFamily: deps.votesPerFamily,
      fullAssets: true,
      noBuild: null,
      runEngine: target.runEngine,
    });
    return result.items[0]?.verdicts ?? {};
  };
}

/** Disagreement per family between a grade and its re-grade; red above 10%. */
export function graderRepeatability(observations: readonly RepeatabilityObservation[]): Diagnostic {
  if (observations.length === 0) return notRun(DiagnosticId.GraderRepeatability);
  const findings: DiagnosticFinding[] = [];
  for (const [family, ofFamily] of groupBy(observations, (entry) => entry.family)) {
    const share = ofFamily.filter((entry) => entry.first !== entry.again).length / ofFamily.length;
    if (share > REPEATABILITY_MAX_DISAGREEMENT)
      findings.push({
        subject: family,
        flag: DiagnosticFlag.GraderUnrepeatable,
        value: share,
        threshold: REPEATABILITY_MAX_DISAGREEMENT,
        n: ofFamily.length,
      });
  }
  return verdict(DiagnosticId.GraderRepeatability, findings, DiagnosticStatus.Block);
}

/** Whether a row carries infrastructure noise: a harness failure, a dirty trace or an API error. */
function plumbingNoise(row: RunRow): boolean {
  const { harnessFailure, traceComplete, providerNoise } = row.outcome;
  const dirtyTrace = traceComplete.truncatedTail || traceComplete.parseFailures > 0;
  return harnessFailure !== null || dirtyTrace || providerNoise.apiErrors > 0;
}

/** The share of noisy rows per case × lane cell; red above 5% of any cell. */
export function plumbing(rows: readonly RunRow[]): Diagnostic {
  const builds = rows.filter((row) => row.kind === RowKind.Build);
  if (builds.length === 0) return notRun(DiagnosticId.Plumbing);
  const findings: DiagnosticFinding[] = [];
  for (const [cell, ofCell] of groupBy(builds, cellOf)) {
    const share = ofCell.filter(plumbingNoise).length / ofCell.length;
    if (share > PLUMBING_MAX_SHARE)
      findings.push({
        subject: cell,
        flag: DiagnosticFlag.PlumbingNoise,
        value: share,
        threshold: PLUMBING_MAX_SHARE,
        n: ofCell.length,
      });
  }
  return verdict(DiagnosticId.Plumbing, findings, DiagnosticStatus.Block);
}

/** A metric's measured values over the rows that count in n. */
function valuesOf(rows: readonly RunRow[], metric: MetricId): number[] {
  const read = METRICS[metric].read;
  if (!read) return [];
  return rows.filter(countsInN).flatMap((row) => {
    const value = read(row);
    return value === null ? [] : [value];
  });
}

/** Per case: the lowest lane mean of the primary; a case at or above 95% everywhere is saturated. */
export function headroom(
  rows: readonly RunRow[],
  metric: MetricId = ENDPOINTS[Axis.ProductDefault].primary,
): Diagnostic {
  const findings: DiagnosticFinding[] = [];
  let measured = 0;
  for (const [caseId, ofCase] of groupBy(rows.filter(countsInN), (row) => row.case.id)) {
    const laneMeans = [...groupBy(ofCase, (row) => row.lane.id).values()]
      .map((ofLane) => mean(valuesOf(ofLane, metric)))
      .filter((value): value is number => value !== null);
    if (laneMeans.length === 0) continue;
    measured += 1;
    const lowest = Math.min(...laneMeans);
    if (lowest >= HEADROOM_SATURATED)
      findings.push({
        subject: caseId,
        flag: DiagnosticFlag.Saturated,
        value: lowest,
        threshold: HEADROOM_SATURATED,
        n: laneMeans.length,
      });
  }
  if (measured === 0) return notRun(DiagnosticId.Headroom);
  return verdict(DiagnosticId.Headroom, findings, DiagnosticStatus.Warn);
}

/** Items that failed in every run of every lane, over at least six runs; the control never counts. */
export function alwaysFailingItems(items: readonly ItemRecord[]): Diagnostic {
  const scored = items.filter((entry) => !entry.item.control);
  if (scored.length === 0) return notRun(DiagnosticId.AlwaysFailingItems);
  const findings: DiagnosticFinding[] = [];
  for (const [itemId, ofItem] of groupBy(scored, (entry) => entry.item.id)) {
    const runs = new Set(ofItem.map((entry) => entry.runId)).size;
    const allFailed = ofItem.every((entry) => entry.combined === ItemVerdict.Fail);
    if (allFailed && runs >= ALWAYS_FAILING_MIN_RUNS)
      findings.push({
        subject: itemId,
        flag: DiagnosticFlag.SuspectItem,
        value: 0,
        threshold: ALWAYS_FAILING_MIN_RUNS,
        n: runs,
      });
  }
  return verdict(DiagnosticId.AlwaysFailingItems, findings, DiagnosticStatus.Warn);
}

/** The pooled within-cell SD of a metric: cells with at least two values, weighted by their degrees of freedom. */
function pooledWithinCellSd(rows: readonly RunRow[], metric: MetricId): number | null {
  let squares = 0;
  let freedom = 0;
  for (const ofCell of groupBy(rows.filter(countsInN), cellOf).values()) {
    const values = valuesOf(ofCell, metric);
    const centre = mean(values);
    if (values.length < 2 || centre === null) continue;
    squares += values.reduce((sum, value) => sum + (value - centre) ** 2, 0);
    freedom += values.length - 1;
  }
  return freedom === 0 ? null : Math.sqrt(squares / freedom);
}

/** The axis primary's MDE (from the pooled within-cell SD over n distinct cases) against its smallest actionable change. */
export function noiseFloor(rows: readonly RunRow[], axis: Axis): Diagnostic {
  const endpoint = ENDPOINTS[axis];
  const sd = pooledWithinCellSd(rows, endpoint.primary);
  const cases = new Set(rows.filter(countsInN).map((row) => row.case.id)).size;
  const mde = sd === null ? null : minimumDetectableDifference(sd, cases);
  if (mde === null) return notRun(DiagnosticId.NoiseFloor);
  const findings: DiagnosticFinding[] = [];
  if (mde >= endpoint.minActionableDelta)
    findings.push({
      subject: axis,
      flag: DiagnosticFlag.MoreDataNeeded,
      value: mde,
      threshold: endpoint.minActionableDelta,
      n: cases,
    });
  return verdict(DiagnosticId.NoiseFloor, findings, DiagnosticStatus.Warn);
}

/** The order efforts rise in. */
const EFFORT_ORDER: readonly string[] = Object.values(Effort);

/** A lane's twin group: same case, agent, engine, mode and model, any effort. */
const twinKey = (row: RunRow): string =>
  [row.case.id, row.lane.agent, row.lane.engine, row.lane.mode, row.model.requested].join("|");

/** One effort's rows in a twin group. */
interface EffortArm {
  rank: number;
  laneId: string;
  mean: number;
}

/** A twin group's arms by effort, each with the primary's mean; arms without a value are left out. */
function effortArms(rows: readonly RunRow[], metric: MetricId): EffortArm[] {
  const arms: EffortArm[] = [];
  for (const [effort, ofEffort] of groupBy(rows, (row) => row.model.effort)) {
    const centre = mean(valuesOf(ofEffort, metric));
    const rank = EFFORT_ORDER.indexOf(effort);
    if (centre !== null && rank >= 0) arms.push({ rank, laneId: ofEffort[0]?.lane.id ?? "", mean: centre });
  }
  return arms.sort((a, b) => a.rank - b.rank);
}

/** An effort-low twin must not score higher than its lane by more than the smallest actionable change. */
export function scalingSanity(rows: readonly RunRow[]): Diagnostic {
  const endpoint = ENDPOINTS[Axis.ProductDefault];
  const findings: DiagnosticFinding[] = [];
  let twins = 0;
  for (const ofGroup of groupBy(rows.filter(countsInN), twinKey).values()) {
    const arms = effortArms(ofGroup, endpoint.primary);
    const highest = arms.at(-1);
    if (arms.length < 2 || !highest) continue;
    twins += 1;
    const rise = Math.max(...arms.slice(0, -1).map((arm) => arm.mean)) - highest.mean;
    if (rise > endpoint.minActionableDelta)
      findings.push({
        subject: `${ofGroup[0]?.case.id} × ${highest.laneId}`,
        flag: DiagnosticFlag.ScalingInverted,
        value: rise,
        threshold: endpoint.minActionableDelta,
        n: ofGroup.length,
      });
  }
  if (twins === 0) return notRun(DiagnosticId.ScalingSanity);
  return verdict(DiagnosticId.ScalingSanity, findings, DiagnosticStatus.Warn);
}

/** What the Diagnostics block is computed from. */
export interface DiagnosticsInput {
  /** The current rows of the campaign or baseline set (after `currentRows()`). */
  rows: readonly RunRow[];
  items: readonly ItemRecord[];
  /** The re-graded sample, or null when none was re-graded (repeatability is then not run). */
  repeatability: readonly RepeatabilityObservation[] | null;
  /** The axes whose primaries get a noise-floor check (default: product-default and version). */
  axes?: readonly Axis[];
}

/** Every diagnostic over one set of rows, in print order. */
export function runDiagnostics(input: DiagnosticsInput): Diagnostics {
  const axes = input.axes ?? [Axis.ProductDefault, Axis.Version];
  const diagnostics = [
    graderRepeatability(input.repeatability ?? []),
    plumbing(input.rows),
    headroom(input.rows),
    alwaysFailingItems(input.items),
    ...axes.map((axis) => noiseFloor(input.rows, axis)),
    scalingSanity(input.rows),
  ];
  const ids = (status: DiagnosticStatus) => [
    ...new Set(diagnostics.filter((entry) => entry.status === status).map((entry) => entry.id)),
  ];
  return { diagnostics, blocking: ids(DiagnosticStatus.Block), notRun: ids(DiagnosticStatus.NotRun) };
}

/** A number as a report prints it: shares as percentages, counts whole. */
function formatValue(value: number | null, threshold: number): string {
  if (value === null) return "not measured";
  return threshold < 1 ? `${(value * 100).toFixed(1)}%` : String(Math.round(value));
}

/** The Diagnostics block as report text. */
export function renderDiagnostics(block: Diagnostics): string {
  const lines = ["Diagnostics"];
  for (const diagnostic of block.diagnostics) {
    lines.push(`  ${diagnostic.id}: ${diagnostic.status}`);
    for (const finding of diagnostic.findings) {
      const numbers = `${formatValue(finding.value, finding.threshold)} vs ${formatValue(finding.threshold, finding.threshold)}, n=${finding.n}`;
      lines.push(`    ${finding.subject}: ${FLAG_TEXT[finding.flag]} (${numbers})`);
    }
  }
  if (block.blocking.length > 0) lines.push(`  Promotion blocked by: ${block.blocking.join(", ")}`);
  return lines.join("\n");
}
