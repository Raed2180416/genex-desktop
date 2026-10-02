/**
 * `campaign plan` (§12, Rules 20–21): the matrix of cases × lanes × reps, and × apps for Genex
 * lanes when `--apps base,cand` puts the version axis in the same campaign. Each provider account
 * gets one stream that runs strictly one run at a time; its builds are drawn in a seeded random
 * order, rep by rep, so base and candidate interleave and no cell runs all its reps back to back.
 * Every (lane, app) of a stream is bracketed by canaries: an opening one with one planned retry,
 * and a closing one. Planning is pure; the file it writes is `campaigns/<campaignId>/campaign.json`.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOUR_MS, MINUTE_MS } from "../../../src/shared/duration.ts";
import type { EngineId } from "../../../src/shared/providers.ts";
import type { EvalCase } from "../case-types.ts";
import { MIN_VOTES_PER_FAMILY } from "../grade/checklist/vote.ts";
import { DEFAULT_GRADER_MODELS } from "../grade/checklist/family.ts";
import { RAIL_GRACE_MS } from "../lanes/common.ts";
import type { LaneRegistry, LaneRegistryRow } from "../lanes/types.ts";
import { isLedgerSafeId } from "../ledger/denylist.ts";
import type { EvalsPaths } from "../ledger/paths.ts";
import { CAMPAIGN_ID_PATTERN, RUN_ID_PATTERN } from "../ledger/types.ts";
import { SEED_PATTERN } from "../ledger/schema.ts";
import { EvalAgent, type GraderFamily, LaneMode, LaneStatus, RowKind } from "../vocabulary.ts";
import {
  AppRole,
  CAMPAIGN_FILE,
  CAMPAIGN_SCHEMA,
  CANARY_CASE_ID,
  CANARY_REP,
  type CampaignEstimates,
  type CampaignPlan,
  CanaryBracket,
  type PlannedApp,
  type PlannedRun,
  type ProviderStream,
} from "./types.ts";

/** The longest a provider quota window lasts; a stream spans at least its hours over this. */
export const QUOTA_WINDOW_HOURS = 5;
/** The most reps a plan accepts per cell. */
export const MAX_REPS = 20;
/** Orders a pairwise judge sees each pair in (§8.5). */
const PAIRWISE_ORDERS = 2;
/** The label a campaign id carries when none is given. */
export const DEFAULT_CAMPAIGN_LABEL = "campaign";
/** A campaign label: the tail of a campaign id. */
const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A full commit SHA, as an eval app build is named. */
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Why a plan was refused, as a code. */
export const CampaignRefusal = {
  UnknownCase: "unknown-case",
  UnknownLane: "unknown-lane",
  FutureLane: "future-lane",
  NoCases: "no-cases",
  NoLanes: "no-lanes",
  NoCanary: "no-canary",
  BadReps: "bad-reps",
  BadDeadline: "bad-deadline",
  BadApps: "bad-apps",
  BadSeed: "bad-seed",
  BadLabel: "bad-label",
  BadCampaignId: "bad-campaign-id",
  BadRunId: "bad-run-id",
  BadPlanFile: "bad-plan-file",
} as const;
export type CampaignRefusal = (typeof CampaignRefusal)[keyof typeof CampaignRefusal];

/** A refused plan or campaign file, by code. */
export class CampaignPlanError extends Error {
  readonly refusal: CampaignRefusal;
  constructor(refusal: CampaignRefusal, detail: string) {
    super(`campaign refused (${refusal}): ${detail}`);
    this.name = "CampaignPlanError";
    this.refusal = refusal;
  }
}

/** What a plan is drawn from; every input is explicit, so planning is pure. */
export interface PlanInput {
  /** Public and holdout cases together. */
  cases: readonly EvalCase[];
  registry: LaneRegistry;
  /** Case ids; the canary is added by the plan and dropped from this list. */
  caseIds: readonly string[];
  /** Lane ids, or registry statuses (`primary`, `harness`, `fixture`) that stand for every lane with it. */
  laneSelectors: readonly string[];
  reps: number;
  /** Empty: one app (none on raw lanes). Two: base then candidate. Full SHAs. */
  apps: readonly string[];
  deadlineMin: number | null;
  seed: string;
  label: string;
  /** Epoch ms the plan is made. */
  nowMs: number;
}

/** `yyyymmddThhmmss` (UTC) of an epoch time, the prefix of every campaign and run id. */
export function campaignStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
}

/** A campaign's folder under the evals home; an id that is not one is refused before it names a path. */
export function campaignDir(paths: EvalsPaths, campaignId: string): string {
  if (!CAMPAIGN_ID_PATTERN.test(campaignId)) throw new CampaignPlanError(CampaignRefusal.BadCampaignId, "not an id");
  return path.join(paths.campaigns, campaignId);
}

/** A run id: `<stamp>-<lane>-<case>[-<app role>]-r<rep>`, checked against the ledger's pattern. */
export function plannedRunId(stamp: string, laneId: string, caseId: string, app: PlannedApp | null, rep: number) {
  const runId = [stamp, laneId, caseId, ...(app ? [app.role] : []), `r${rep}`].join("-");
  if (!RUN_ID_PATTERN.test(runId)) throw new CampaignPlanError(CampaignRefusal.BadRunId, runId);
  return runId;
}

/** The lanes the selectors name, in registry order; a future lane (no runner) is refused. */
export function selectLanes(registry: LaneRegistry, selectors: readonly string[]): LaneRegistryRow[] {
  const statuses: readonly string[] = Object.values(LaneStatus);
  const picked = new Set<string>();
  for (const selector of selectors) {
    const byStatus = statuses.includes(selector) ? registry.lanes.filter((lane) => lane.status === selector) : [];
    const byId = registry.lanes.filter((lane) => lane.id === selector);
    const matched = [...byStatus, ...byId];
    if (!matched.length) throw new CampaignPlanError(CampaignRefusal.UnknownLane, selector);
    for (const lane of matched) picked.add(lane.id);
  }
  const lanes = registry.lanes.filter((lane) => picked.has(lane.id));
  const future = lanes.find((lane) => lane.status === LaneStatus.Future);
  if (future) throw new CampaignPlanError(CampaignRefusal.FutureLane, future.id);
  if (!lanes.length) throw new CampaignPlanError(CampaignRefusal.NoLanes, "no lane selected");
  return lanes;
}

/** The cases the ids name, in the order given, without the canary. */
function selectCases(cases: readonly EvalCase[], ids: readonly string[]): EvalCase[] {
  const out: EvalCase[] = [];
  for (const id of new Set(ids)) {
    if (id === CANARY_CASE_ID) continue;
    const found = cases.find((c) => c.id === id);
    if (!found) throw new CampaignPlanError(CampaignRefusal.UnknownCase, id);
    out.push(found);
  }
  if (!out.length) throw new CampaignPlanError(CampaignRefusal.NoCases, "no case selected");
  return out;
}

/** The apps as base then candidate; none, one or two distinct full SHAs. */
function plannedApps(apps: readonly string[]): PlannedApp[] {
  const distinct = new Set(apps).size === apps.length;
  const shaped = apps.every((sha) => FULL_SHA_PATTERN.test(sha));
  if (apps.length > 2 || !distinct || !shaped) throw new CampaignPlanError(CampaignRefusal.BadApps, apps.join(","));
  const roles = [AppRole.Base, AppRole.Candidate];
  return apps.map((sha, index) => ({ role: roles[index] ?? AppRole.Candidate, sha }));
}

/** A Genex lane runs once per app; a raw lane runs once, with no app. */
function appsOf(lane: LaneRegistryRow, apps: readonly PlannedApp[]): Array<PlannedApp | null> {
  return lane.agent === EvalAgent.GenexApp ? [...apps] : [null];
}

/** The seeded position of a run in its rep: sha256 of the seed and the run's own key. */
function orderKey(seed: string, engine: EngineId, key: string): string {
  return createHash("sha256").update(`${seed}\0${engine}\0${key}`).digest("hex");
}

function assertInputs(input: PlanInput, lanes: readonly LaneRegistryRow[], apps: readonly PlannedApp[]): void {
  if (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > MAX_REPS)
    throw new CampaignPlanError(CampaignRefusal.BadReps, String(input.reps));
  const deadline = input.deadlineMin;
  if (deadline !== null && (!Number.isInteger(deadline) || deadline <= 0))
    throw new CampaignPlanError(CampaignRefusal.BadDeadline, String(deadline));
  if (!SEED_PATTERN.test(input.seed)) throw new CampaignPlanError(CampaignRefusal.BadSeed, "not a seed");
  // The label ends up in every row's campaign id, so the ledger guard must accept it before any run.
  if (!LABEL_PATTERN.test(input.label) || !isLedgerSafeId(input.label))
    throw new CampaignPlanError(CampaignRefusal.BadLabel, "not a label");
  const needsApp = lanes.some((lane) => lane.agent === EvalAgent.GenexApp);
  if (needsApp && !apps.length) throw new CampaignPlanError(CampaignRefusal.BadApps, "a Genex lane needs an app SHA");
}

/** One stream's canaries: an opening one (and its retry) and a closing one per (lane, app). */
function canaries(
  stamp: string,
  lanes: readonly LaneRegistryRow[],
  apps: readonly PlannedApp[],
  bracket: CanaryBracket,
) {
  return lanes.flatMap((lane) =>
    appsOf(lane, apps).map(
      (app): PlannedRun => ({
        runId: plannedRunId(stamp, lane.id, CANARY_CASE_ID, app, CANARY_REP[bracket]),
        kind: RowKind.Canary,
        laneId: lane.id,
        caseId: CANARY_CASE_ID,
        rep: CANARY_REP[bracket],
        app,
        bracket,
      }),
    ),
  );
}

/** One stream's builds: rep by rep, each rep's cells in the seeded order. */
function streamBuilds(
  input: PlanInput,
  stamp: string,
  engine: EngineId,
  lanes: readonly LaneRegistryRow[],
  cases: readonly EvalCase[],
  apps: readonly PlannedApp[],
): PlannedRun[] {
  const out: PlannedRun[] = [];
  for (let rep = 1; rep <= input.reps; rep++) {
    const cells = lanes.flatMap((lane) =>
      appsOf(lane, apps).flatMap((app) =>
        cases.map(
          (evalCase): PlannedRun => ({
            runId: plannedRunId(stamp, lane.id, evalCase.id, app, rep),
            kind: RowKind.Build,
            laneId: lane.id,
            caseId: evalCase.id,
            rep,
            app,
            bracket: null,
          }),
        ),
      ),
    );
    const keyed = cells.map((run) => ({ run, key: orderKey(input.seed, engine, run.runId.slice(stamp.length)) }));
    out.push(...keyed.sort((a, b) => (a.key < b.key ? -1 : Number(a.key > b.key))).map((entry) => entry.run));
  }
  return out;
}

/**
 * The pairs a campaign's grader judges per case, rep and app (§8.5): Genex against the raw CLI of
 * the same engine (product axis), the two engines of the same agent kind and mode (model axis), and
 * each Genex lane's base against its candidate (version axis).
 */
function pairsPerCaseRep(lanes: readonly LaneRegistryRow[], apps: readonly PlannedApp[]): number {
  let pairs = 0;
  const genex = lanes.filter((lane) => lane.agent === EvalAgent.GenexApp);
  const raw = lanes.filter((lane) => lane.agent !== EvalAgent.GenexApp);
  const perApp = Math.max(apps.length, 1);
  for (const a of genex.filter((lane) => lane.mode === LaneMode.ProductDefault))
    pairs += raw.filter((b) => b.engine === a.engine).length * perApp;
  for (const group of [genex, raw]) {
    for (const [index, a] of group.entries())
      pairs += group.slice(index + 1).filter((b) => b.engine !== a.engine && b.mode === a.mode).length;
  }
  if (apps.length === 2) pairs += genex.length;
  return pairs;
}

/** Deadline plus grace of one run, in hours. */
function runHours(deadlineMin: number): number {
  return (deadlineMin * MINUTE_MS + RAIL_GRACE_MS) / HOUR_MS;
}

const roundTenth = (value: number) => Math.round(value * 10) / 10;

/** Build hours per stream, grading calls per family and quota windows per stream. */
function estimate(
  input: PlanInput,
  streams: readonly ProviderStream[],
  cases: readonly EvalCase[],
  canary: EvalCase,
  lanes: readonly LaneRegistryRow[],
  apps: readonly PlannedApp[],
): CampaignEstimates {
  const deadlineOf = (caseId: string) =>
    caseId === CANARY_CASE_ID
      ? canary.deadlineMin
      : (input.deadlineMin ?? cases.find((c) => c.id === caseId)?.deadlineMin ?? canary.deadlineMin);
  const buildHoursByStream: CampaignEstimates["buildHoursByStream"] = {};
  const quotaWindowsByStream: CampaignEstimates["quotaWindowsByStream"] = {};
  for (const stream of streams) {
    const counted = [...stream.opening.filter((run) => run.bracket === CanaryBracket.Opening), ...stream.builds];
    const hours = [...counted, ...stream.closing].reduce((sum, run) => sum + runHours(deadlineOf(run.caseId)), 0);
    buildHoursByStream[stream.engine] = roundTenth(hours);
    quotaWindowsByStream[stream.engine] = Math.ceil(hours / QUOTA_WINDOW_HOURS);
  }
  const builds = streams.flatMap((stream) => stream.builds);
  const votes = builds.reduce(
    (sum, run) => sum + (cases.find((c) => c.id === run.caseId)?.acceptance.length ?? 0) * MIN_VOTES_PER_FAMILY,
    0,
  );
  const pairwise = pairsPerCaseRep(lanes, apps) * cases.length * input.reps * PAIRWISE_ORDERS;
  const gradingCallsByFamily: Partial<Record<GraderFamily, number>> = {};
  for (const grader of DEFAULT_GRADER_MODELS) gradingCallsByFamily[grader.family] = votes + pairwise;
  const hours = Object.values(buildHoursByStream);
  return {
    builds: builds.length,
    canaries: streams.reduce((sum, s) => sum + s.opening.length + s.closing.length, 0),
    buildHoursByStream,
    buildHoursWall: Math.max(0, ...hours),
    gradingCallsByFamily,
    quotaWindowsByStream,
  };
}

/** Plan a campaign: pure; the caller writes it with `writeCampaignPlan`. */
export function planCampaign(input: PlanInput): CampaignPlan {
  const lanes = selectLanes(input.registry, input.laneSelectors);
  const cases = selectCases(input.cases, input.caseIds);
  const canary = input.cases.find((c) => c.id === CANARY_CASE_ID);
  if (!canary) throw new CampaignPlanError(CampaignRefusal.NoCanary, "the case file has no canary");
  const apps = plannedApps(input.apps);
  assertInputs(input, lanes, apps);
  const stamp = campaignStamp(input.nowMs);
  const engines = [...new Set(lanes.map((lane) => lane.engine))];
  const streams = engines.map((engine): ProviderStream => {
    const own = lanes.filter((lane) => lane.engine === engine);
    const opening = [CanaryBracket.Opening, CanaryBracket.OpeningRetry].flatMap((bracket) =>
      canaries(stamp, own, apps, bracket),
    );
    return {
      engine,
      opening,
      builds: streamBuilds(input, stamp, engine, own, cases, apps),
      closing: canaries(stamp, own, apps, CanaryBracket.Closing),
    };
  });
  return {
    schema: CAMPAIGN_SCHEMA,
    campaignId: `${stamp}-${input.label}`,
    createdAt: new Date(input.nowMs).toISOString(),
    seed: input.seed,
    reps: input.reps,
    deadlineMin: input.deadlineMin,
    apps,
    cases: [...cases, canary].map((c) => ({
      id: c.id,
      version: c.version,
      visibility: c.visibility,
      deadlineMin: c.id === CANARY_CASE_ID ? c.deadlineMin : (input.deadlineMin ?? c.deadlineMin),
    })),
    lanes: lanes.map((lane) => ({ id: lane.id, engine: lane.engine, flagsDigest: lane.flagsDigest })),
    streams,
    estimates: estimate(input, streams, cases, canary, lanes, apps),
  };
}

/** Every planned run of a plan, openings, builds and closings of every stream. */
export function plannedRuns(plan: CampaignPlan): PlannedRun[] {
  return plan.streams.flatMap((stream) => [...stream.opening, ...stream.builds, ...stream.closing]);
}

/** The printed plan: the matrix, each stream's seeded order with its canary brackets, and the estimates. */
export function formatPlan(plan: CampaignPlan): string {
  const lines = [
    `campaign ${plan.campaignId} (seed ${plan.seed})`,
    `matrix: ${plan.cases.filter((c) => c.id !== CANARY_CASE_ID).length} cases x ${plan.lanes.length} lanes x ${plan.reps} reps` +
      (plan.apps.length ? ` x apps ${plan.apps.map((app) => `${app.role}=${app.sha.slice(0, 12)}`).join(",")}` : ""),
  ];
  for (const stream of plan.streams) {
    lines.push(`stream ${stream.engine}:`);
    for (const run of stream.opening) lines.push(`  [${run.bracket}] ${run.runId}`);
    for (const run of stream.builds) lines.push(`  ${run.runId}`);
    for (const run of stream.closing) lines.push(`  [${run.bracket}] ${run.runId}`);
  }
  const e = plan.estimates;
  lines.push(
    `estimates: ${e.builds} builds, ${e.canaries} canary slots; build hours ${JSON.stringify(e.buildHoursByStream)} (wall ${e.buildHoursWall})`,
    `grading calls per family ${JSON.stringify(e.gradingCallsByFamily)}; quota windows ${JSON.stringify(e.quotaWindowsByStream)}`,
  );
  return lines.join("\n");
}

/** Write a plan to its campaign folder; answers the file. */
export async function writeCampaignPlan(paths: EvalsPaths, plan: CampaignPlan): Promise<string> {
  const dir = campaignDir(paths, plan.campaignId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, CAMPAIGN_FILE);
  await writeFile(file, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  return file;
}

/** Read a campaign's plan back; a missing or foreign file is refused. */
export async function readCampaignPlan(paths: EvalsPaths, campaignId: string): Promise<CampaignPlan> {
  const file = path.join(campaignDir(paths, campaignId), CAMPAIGN_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) throw new CampaignPlanError(CampaignRefusal.BadPlanFile, `no plan for ${campaignId}`);
  const plan = JSON.parse(text) as Partial<CampaignPlan>;
  const shaped = plan.schema === CAMPAIGN_SCHEMA && plan.campaignId === campaignId && Array.isArray(plan.streams);
  if (!shaped) throw new CampaignPlanError(CampaignRefusal.BadPlanFile, campaignId);
  const full = plan as CampaignPlan;
  for (const run of plannedRuns(full))
    if (!RUN_ID_PATTERN.test(run.runId)) throw new CampaignPlanError(CampaignRefusal.BadPlanFile, "a planned run id");
  return full;
}
