/**
 * Baseline promotion (§10.4) as a pure decision: `baseline promote --campaign <id>` refuses unless
 * both canaries passed, no harness failure is unreplaced, every cell has ≥ 3 counted runs, the
 * calibration is green, no grade is quick and every cell's rows share their pins (holdout cells
 * included). Otherwise it yields one baseline per public case (a holdout is withheld, never
 * committed): raw values per metric per lane (never a summary; null stays null),
 * the run ids they came from, the lane's pin facts, and the epoch (a digest of each lane's CLI
 * version and served main model: a CLI or model change opens a new epoch). The caller writes each
 * file to `evals/baselines/<case>.json` and formats it.
 */
import crypto from "node:crypto";
import { EndedHow } from "../../../src/shared/eval-lane.ts";
import { DATE_PATTERN, INSTANT_PATTERN, SHORT_DIGEST_PATTERN, SLUG_PATTERN, type RunRow } from "../ledger/types.ts";
import { Axis, CaseExposure, CaseVisibility, CheckResult, NoteCode } from "../vocabulary.ts";
import { AXIS_FIELDS, comparabilityKey, PinField, sharedPinsRefusal, showPinFact } from "./comparability.ts";
import { countsInN, ENDPOINTS_SHA, METRICS, MetricId } from "./endpoints.ts";

/** The committed baseline file's schema id. */
export const BASELINE_SCHEMA = "genex-evals/baseline/1";
/** A cell needs at least this many counted runs to be promoted (§10.4). */
export const BASELINE_MIN_RUNS_PER_CELL = 3;

/** Why a promotion is refused. */
export const PromoteRefusal = {
  NoRuns: "no-runs",
  MixedCampaign: "mixed-campaign",
  OpeningCanary: "opening-canary",
  ClosingCanary: "closing-canary",
  CampaignVoid: "campaign-void",
  UnreplacedHarnessFailure: "unreplaced-harness-failure",
  TooFewRuns: "too-few-runs",
  CalibrationRed: "calibration-red",
  QuickGrade: "quick-grade",
  Incomparable: "incomparable",
  /** Every counted row is a holdout's, and a holdout never becomes a committed baseline. */
  NoPublicCases: "no-public-cases",
} as const;
export type PromoteRefusal = (typeof PromoteRefusal)[keyof typeof PromoteRefusal];

/** One refusal and the ids it names. */
export interface PromoteRefusalEntry {
  code: PromoteRefusal;
  /** Run ids, `case × lane` cells, or a pin refusal, as a caller-facing detail. */
  detail: string;
}

/** What a promotion is decided from. */
export interface PromoteInput {
  campaignId: string;
  rows: readonly RunRow[];
  openingCanary: CheckResult;
  closingCanary: CheckResult;
  calibrationGreen: boolean;
  promotedAt: string;
}

/** Metrics a baseline keeps: every metric read from a single run. */
const BASELINE_METRICS: readonly MetricId[] = Object.values(MetricId).filter((id) => METRICS[id].read !== null);

/** One lane's raw values in one case's baseline. */
export interface BaselineLane {
  laneId: string;
  runIds: string[];
  /** How each run ended, aligned with `runIds`, so time-to-done can be censored again. */
  endedHow: EndedHow[];
  /** Pin facts as the comparator prints them. */
  pins: Record<PinField, string>;
  /** Raw values aligned with `runIds`; null where the run did not measure it. */
  metrics: Record<MetricId, (number | null)[]>;
}

/** A committed baseline: one case, one campaign, raw values per lane. */
export interface BaselineFile {
  schema: typeof BASELINE_SCHEMA;
  caseId: string;
  caseVersion: string;
  exposure: CaseExposure;
  campaignId: string;
  promotedAt: string;
  epoch: string;
  endpointsSha: string;
  lanes: BaselineLane[];
}

/**
 * A promotion: the public cases' baselines and how many holdout cases were withheld (they gate the
 * promotion but never become a committed file), or every reason it was refused.
 */
export type PromoteDecision =
  | { ok: true; baselines: BaselineFile[]; withheldHoldouts: number }
  | { ok: false; refusals: PromoteRefusalEntry[] };

function cellKey(row: RunRow): string {
  return `${row.case.id} × ${row.lane.id}`;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

function isQuick(row: RunRow): boolean {
  return row.probe?.quick === true || row.notes.includes(NoteCode.QuickGrade);
}

function campaignRefusals(input: PromoteInput): PromoteRefusalEntry[] {
  const refusals: PromoteRefusalEntry[] = [];
  const other = input.rows.filter((row) => row.campaignId !== input.campaignId).map((row) => row.runId);
  if (other.length > 0) refusals.push({ code: PromoteRefusal.MixedCampaign, detail: other.join(", ") });
  if (input.openingCanary !== CheckResult.Pass)
    refusals.push({ code: PromoteRefusal.OpeningCanary, detail: input.openingCanary });
  if (input.closingCanary !== CheckResult.Pass)
    refusals.push({ code: PromoteRefusal.ClosingCanary, detail: input.closingCanary });
  if (!input.calibrationGreen)
    refusals.push({ code: PromoteRefusal.CalibrationRed, detail: "calibration is not green" });
  const voided = input.rows.find((row) => row.campaignVoid !== null);
  if (voided) refusals.push({ code: PromoteRefusal.CampaignVoid, detail: voided.campaignVoid ?? "" });
  return refusals;
}

function rowRefusals(rows: readonly RunRow[]): PromoteRefusalEntry[] {
  const refusals: PromoteRefusalEntry[] = [];
  const unreplaced = rows.filter((row) => row.outcome.harnessFailure !== null && row.supersededBy === null);
  if (unreplaced.length > 0) {
    const detail = unreplaced.map((row) => `${row.runId} (${row.outcome.harnessFailure})`).join(", ");
    refusals.push({ code: PromoteRefusal.UnreplacedHarnessFailure, detail });
  }
  const quick = rows.filter(isQuick).map((row) => row.runId);
  if (quick.length > 0) refusals.push({ code: PromoteRefusal.QuickGrade, detail: quick.join(", ") });
  return refusals;
}

function cellRefusals(counted: readonly RunRow[]): PromoteRefusalEntry[] {
  const refusals: PromoteRefusalEntry[] = [];
  for (const [cell, rows] of groupBy(counted, cellKey)) {
    if (rows.length < BASELINE_MIN_RUNS_PER_CELL) {
      refusals.push({
        code: PromoteRefusal.TooFewRuns,
        detail: `${cell}: ${rows.length} of ${BASELINE_MIN_RUNS_PER_CELL}`,
      });
    }
    const refusal = sharedPinsRefusal(rows);
    if (refusal) refusals.push({ code: PromoteRefusal.Incomparable, detail: `${cell}: ${refusal.text}` });
  }
  return refusals;
}

/** A digest of each lane's CLI version and served main model: a change in either opens a new epoch. */
export function epochOf(rows: readonly RunRow[]): string {
  const facts = new Set(
    rows.map((row) => {
      const key = comparabilityKey(row);
      return `${row.lane.id}|${showPinFact(key[PinField.CliVersion])}|${showPinFact(key[PinField.ModelMain])}`;
    }),
  );
  return crypto
    .createHash("sha256")
    .update([...facts].sort().join("\n"))
    .digest("hex")
    .slice(0, 12);
}

function baselineLane(rows: readonly RunRow[]): BaselineLane {
  const ordered = [...rows].sort((x, y) => x.runId.localeCompare(y.runId));
  const key = comparabilityKey(ordered[0]);
  const pins = Object.fromEntries(Object.values(PinField).map((field) => [field, showPinFact(key[field])]));
  const metrics = Object.fromEntries(
    BASELINE_METRICS.map((id) => [id, ordered.map((row) => METRICS[id].read?.(row) ?? null)]),
  );
  return {
    laneId: ordered[0].lane.id,
    runIds: ordered.map((row) => row.runId),
    endedHow: ordered.map((row) => row.outcome.endedHow),
    pins: pins as Record<PinField, string>,
    metrics: metrics as Record<MetricId, (number | null)[]>,
  };
}

/**
 * Decide a promotion from a campaign's current rows (after `currentRows()`). Every counted row,
 * holdouts included, must pass the checks; only public cases become baselines, since a baseline
 * is committed to the public repository and a holdout's id and runs never enter Git (§6.3).
 */
export function promoteDecision(input: PromoteInput): PromoteDecision {
  const counted = input.rows.filter(countsInN);
  if (counted.length === 0) return { ok: false, refusals: [{ code: PromoteRefusal.NoRuns, detail: input.campaignId }] };
  const refusals = [...campaignRefusals(input), ...rowRefusals(input.rows), ...cellRefusals(counted)];
  const publicRows = counted.filter((row) => row.case.visibility === CaseVisibility.Public);
  if (publicRows.length === 0) refusals.push({ code: PromoteRefusal.NoPublicCases, detail: input.campaignId });
  if (refusals.length > 0) return { ok: false, refusals };
  const epoch = epochOf(counted);
  const baselines = [...groupBy(publicRows, (row) => row.case.id)].sort(([a], [b]) => a.localeCompare(b));
  const holdouts = new Set(counted.map((row) => row.case.id)).size - baselines.length;
  return {
    ok: true,
    withheldHoldouts: holdouts,
    baselines: baselines.map(([caseId, rows]) => ({
      schema: BASELINE_SCHEMA,
      caseId,
      caseVersion: rows[0].case.version,
      exposure: rows[0].case.exposure,
      campaignId: input.campaignId,
      promotedAt: input.promotedAt,
      epoch,
      endpointsSha: ENDPOINTS_SHA,
      lanes: [...groupBy(rows, (row) => row.lane.id)]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, laneRows]) => baselineLane(laneRows)),
    })),
  };
}

/** How a pin the baseline file does not carry prints in a refusal. */
const MISSING_PIN = "missing";

/**
 * Why a committed baseline lane may not be the base of these candidate rows of its cell, as
 * `<field> <baseline> vs <candidate>`, or null when it may (§10.1, §10.4, §10.6). The case version,
 * the endpoints and every pin outside the version axis must match: a CLI or model change is a new
 * epoch, a prober or grader bump needs `regrade --baseline` first. Only counted rows are checked.
 */
export function baselineLaneRefusal(
  baseline: BaselineFile,
  lane: BaselineLane,
  rows: readonly RunRow[],
): string | null {
  if (baseline.endpointsSha !== ENDPOINTS_SHA)
    return `${PinField.EndpointsSha} ${baseline.endpointsSha} vs ${ENDPOINTS_SHA}`;
  const free = new Set<PinField>(AXIS_FIELDS[Axis.Version]);
  const pinned = Object.values(PinField).filter((field) => !free.has(field));
  for (const row of rows.filter(countsInN)) {
    if (row.case.version !== baseline.caseVersion)
      return `${PinField.CaseVersion} ${baseline.caseVersion} vs ${row.case.version}`;
    const key = comparabilityKey(row);
    for (const field of pinned) {
      const committed = lane.pins?.[field] ?? MISSING_PIN;
      const candidate = showPinFact(key[field]);
      if (committed !== candidate) return `${field} ${committed} vs ${candidate}`;
    }
  }
  return null;
}

/** The file text: two-space JSON with a trailing newline (the caller still runs `biome format --write`). */
export function baselineJson(file: BaselineFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A baseline file that failed validation, naming the field. */
export class BaselineError extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(`baseline (${field}): ${detail}`);
    this.name = "BaselineError";
    this.field = field;
  }
}

/** The field a committed baseline failed to read on (`json` when it is not JSON), or null for any other error. */
export function baselineFault(error: unknown): string | null {
  if (error instanceof BaselineError) return error.field;
  return error instanceof SyntaxError ? "json" : null;
}

function expect(ok: boolean, field: string, detail: string): void {
  if (!ok) throw new BaselineError(field, detail);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkLane(lane: unknown, index: number): void {
  const at = `lanes[${index}]`;
  expect(isRecord(lane), at, "must be an object");
  const record = lane as Record<string, unknown>;
  expect(typeof record.laneId === "string" && SLUG_PATTERN.test(record.laneId), `${at}.laneId`, "must be a slug");
  const runIds = record.runIds;
  expect(Array.isArray(runIds) && runIds.every((id) => typeof id === "string"), `${at}.runIds`, "must list run ids");
  const count = (runIds as string[]).length;
  const endedHow = record.endedHow;
  const endings: readonly unknown[] = Object.values(EndedHow);
  const validEndings =
    Array.isArray(endedHow) && endedHow.length === count && endedHow.every((e) => endings.includes(e));
  expect(validEndings, `${at}.endedHow`, "must align with runIds");
  expect(isRecord(record.metrics), `${at}.metrics`, "must be an object");
  for (const [metric, values] of Object.entries(record.metrics as Record<string, unknown>)) {
    expect(BASELINE_METRICS.includes(metric as MetricId), `${at}.metrics`, `unknown metric ${metric}`);
    const aligned = Array.isArray(values) && values.length === count;
    const numeric = aligned && values.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)));
    expect(numeric, `${at}.metrics.${metric}`, "must hold a number or null per run");
  }
}

/** Parse and validate a committed baseline; a malformed file names its field. */
export function parseBaseline(text: string): BaselineFile {
  const value: unknown = JSON.parse(text);
  expect(isRecord(value), "(root)", "must be an object");
  const file = value as Record<string, unknown>;
  expect(file.schema === BASELINE_SCHEMA, "schema", `must be ${BASELINE_SCHEMA}`);
  expect(typeof file.caseId === "string" && SLUG_PATTERN.test(file.caseId), "caseId", "must be a slug");
  expect(
    typeof file.caseVersion === "string" && SHORT_DIGEST_PATTERN.test(file.caseVersion),
    "caseVersion",
    "must be a short digest",
  );
  expect(Object.values<unknown>(CaseExposure).includes(file.exposure), "exposure", "must be an exposure code");
  expect(typeof file.epoch === "string" && SHORT_DIGEST_PATTERN.test(file.epoch), "epoch", "must be a short digest");
  expect(
    typeof file.endpointsSha === "string" && SHORT_DIGEST_PATTERN.test(file.endpointsSha),
    "endpointsSha",
    "must be a short digest",
  );
  const instant =
    typeof file.promotedAt === "string" &&
    (INSTANT_PATTERN.test(file.promotedAt) || DATE_PATTERN.test(file.promotedAt));
  expect(instant, "promotedAt", "must be an instant");
  expect(Array.isArray(file.lanes), "lanes", "must be a list");
  (file.lanes as unknown[]).forEach(checkLane);
  return value as BaselineFile;
}
