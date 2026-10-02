/**
 * What a review session asks, in what order (§8.6, §10.7). Pair mode takes the pairs the pairwise
 * judge saw in the campaign (or, before any judge ran, every two runs of one case and rep), places
 * each side left or right from a recorded seed, and shuffles the pairs, so neither the position nor
 * the sequence tells a lane. Grader-validation mode draws a seeded sample of judged checklist items
 * this reviewer has not labelled yet (10% of the campaign's judged items, at least five, unless the
 * session asks for another number). Only build rows count: canaries, calibration rows, harness failures and replaced reps never reach
 * a reviewer. What this reviewer already answered is left out, so a session can be resumed.
 */
import { createHash } from "node:crypto";
import type { EvalCase } from "../case-types.ts";
import type { PairwiseRow, RunRow } from "../ledger/types.ts";
import { seededRandom } from "../report/stats.ts";
import { RowKind } from "../vocabulary.ts";
import { type ChecklistItemView, checklistItems, type ReviewSide, reviewSide } from "./evidence.ts";
import { labelledItemId, type ReviewRow } from "./rows.ts";

/** What a review session shows. */
export const ReviewMode = {
  Pair: "pair",
  GraderValidation: "grader-validation",
} as const;
export type ReviewMode = (typeof ReviewMode)[keyof typeof ReviewMode];

/** The share of judged items a grader-validation session samples by default (§10.7). */
export const VALIDATION_SAMPLE_SHARE = 0.1;
/** The fewest items a grader-validation session samples when that many exist. */
export const VALIDATION_SAMPLE_MIN = 5;
/** How many hex characters of a digest a pair's placement seed keeps. */
const PLACEMENT_SEED_CHARS = 16;
const REP_SUFFIX = /-r(\d+)$/;

/** The case as the reviewer reads it; null when the case file no longer holds this version. */
export interface CaseText {
  label: string;
  brief: string;
}

interface TaskBase {
  campaignId: string;
  caseId: string;
  caseVersion: string;
  caseText: CaseText | null;
  placementSeed: string;
}

/** One blind pair: `left` is shown as A, `right` as B. */
export interface PairTask extends TaskBase {
  mode: typeof ReviewMode.Pair;
  left: ReviewSide;
  right: ReviewSide;
}

/** One checklist item of one run, with both families' verdicts and the frames they saw. */
export interface ItemTask extends TaskBase {
  mode: typeof ReviewMode.GraderValidation;
  runId: string;
  item: ChecklistItemView;
  side: ReviewSide;
}

/** Anything a session asks. */
export type ReviewTask = PairTask | ItemTask;

/** What a session is built from; `ledgerReviewSource` reads the real ledger and evidence. */
export interface ReviewSource {
  /** The campaign's current run rows (`currentRows()`). */
  runs(campaignId: string): Promise<RunRow[]>;
  pairwise(campaignId: string): Promise<PairwiseRow[]>;
  /** Every human row in the ledger, so what this reviewer already answered is left out. */
  human(): Promise<ReviewRow[]>;
  /** The frames of a run's current grade. */
  side(run: RunRow): Promise<ReviewSide>;
  /** The judged checklist items of a run's current grade. */
  checklist(run: RunRow): Promise<ChecklistItemView[]>;
  cases(): readonly EvalCase[];
}

/** One session's request. */
export interface ReviewRequest {
  campaignId: string;
  mode: ReviewMode;
  /** The session seed: pair order and placement, or the item sample, derive from it. */
  seed: string;
  reviewerId: string;
  /** How many items a grader-validation session samples; null for the default. */
  sample: number | null;
}

/** Two runs of one case and rep, in the pair's own order. */
export interface RunPair {
  first: RunRow;
  second: RunRow;
}

/** The rep a run id ends with, or null. */
export function repOf(runId: string): number | null {
  const match = REP_SUFFIX.exec(runId);
  return match ? Number(match[1]) : null;
}

/** Whether a run may be reviewed: a build row of this campaign that was neither a harness failure nor replaced. */
function reviewable(row: RunRow, campaignId: string): boolean {
  const counted = row.outcome.harnessFailure === null && row.supersededBy === null;
  return row.campaignId === campaignId && row.kind === RowKind.Build && counted && row.campaignVoid === null;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every two runs of one case and rep, the lanes in id order. */
function sameCellPairs(runs: readonly RunRow[]): RunPair[] {
  const groups = new Map<string, RunRow[]>();
  for (const row of runs) {
    const key = `${row.case.id}#${repOf(row.runId)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const pairs: RunPair[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => (a.lane.id < b.lane.id ? -1 : 1));
    for (const [index, first] of sorted.entries())
      for (const second of sorted.slice(index + 1)) if (first.lane.id !== second.lane.id) pairs.push({ first, second });
  }
  return pairs;
}

/** The campaign's pairs: those the pairwise judge saw, else every two runs of one case and rep. */
export function campaignPairs(
  runs: readonly RunRow[],
  pairwise: readonly PairwiseRow[],
  campaignId: string,
): RunPair[] {
  const byId = new Map(runs.filter((row) => reviewable(row, campaignId)).map((row) => [row.runId, row]));
  const judged = pairwise.filter((row) => row.campaignId === campaignId);
  if (!judged.length) return sameCellPairs([...byId.values()]);
  const pairs = new Map<string, RunPair>();
  for (const row of judged) {
    const first = byId.get(row.runIds.first);
    const second = byId.get(row.runIds.second);
    const key = pairKey(row.runIds.first, row.runIds.second);
    if (first && second && !pairs.has(key)) pairs.set(key, { first, second });
  }
  return [...pairs.values()];
}

/** A pair's placement seed: the session seed and the pair's two runs, digested. */
export function placementSeedFor(sessionSeed: string, a: string, b: string): string {
  return createHash("sha256")
    .update(`${sessionSeed}:${pairKey(a, b)}`)
    .digest("hex")
    .slice(0, PLACEMENT_SEED_CHARS);
}

/** Whether the pair's first run goes on the left, drawn from its recorded placement seed. */
export function firstOnLeft(placementSeed: string): boolean {
  return (createHash("sha256").update(placementSeed).digest()[0] ?? 0) % 2 === 0;
}

/** `items` in a seeded order (Fisher–Yates over `seededRandom`). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = seededRandom(seed);
  const out = [...items];
  for (let index = out.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other] as T, out[index] as T];
  }
  return out;
}

/** How many of `available` items a validation session samples: the request, else 10% and at least five. */
export function validationSampleSize(available: number, requested: number | null): number {
  const wanted = requested ?? Math.max(VALIDATION_SAMPLE_MIN, Math.ceil(available * VALIDATION_SAMPLE_SHARE));
  return Math.max(0, Math.min(available, wanted));
}

/** The case text for a run's case, only when the case file still holds the version the run was built from. */
function caseTextFor(cases: readonly EvalCase[], row: RunRow): CaseText | null {
  const found = cases.find((evalCase) => evalCase.id === row.case.id && evalCase.version === row.case.version);
  return found ? { label: found.label, brief: found.brief } : null;
}

function baseFor(row: RunRow, cases: readonly EvalCase[], placementSeed: string): TaskBase {
  return {
    campaignId: row.campaignId,
    caseId: row.case.id,
    caseVersion: row.case.version,
    caseText: caseTextFor(cases, row),
    placementSeed,
  };
}

/** The pairs this reviewer already reviewed, as unordered run-id keys. */
function reviewedPairs(rows: readonly ReviewRow[], reviewerId: string): Set<string> {
  const mine = rows.filter((row) => row.reviewerId === reviewerId && labelledItemId(row) === null);
  return new Set(mine.map((row) => pairKey(row.runIds.a, row.runIds.b)));
}

/** The items this reviewer already labelled, as `runId#itemId`. */
function labelledItems(rows: readonly ReviewRow[], reviewerId: string): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const itemId = labelledItemId(row);
    if (row.reviewerId === reviewerId && itemId !== null) keys.add(`${row.runIds.a}#${itemId}`);
  }
  return keys;
}

async function pairTasks(request: ReviewRequest, source: ReviewSource): Promise<PairTask[]> {
  const pairs = campaignPairs(
    await source.runs(request.campaignId),
    await source.pairwise(request.campaignId),
    request.campaignId,
  );
  const done = reviewedPairs(await source.human(), request.reviewerId);
  const cases = source.cases();
  const tasks: PairTask[] = [];
  for (const { first, second } of seededShuffle(pairs, `${request.seed}:order`)) {
    if (done.has(pairKey(first.runId, second.runId))) continue;
    const placementSeed = placementSeedFor(request.seed, first.runId, second.runId);
    const [left, right] = firstOnLeft(placementSeed) ? [first, second] : [second, first];
    tasks.push({
      ...baseFor(first, cases, placementSeed),
      mode: ReviewMode.Pair,
      left: await source.side(left),
      right: await source.side(right),
    });
  }
  return tasks;
}

interface ItemCandidate {
  row: RunRow;
  item: ChecklistItemView;
}

async function itemTasks(request: ReviewRequest, source: ReviewSource): Promise<ItemTask[]> {
  const runs = (await source.runs(request.campaignId)).filter((row) => reviewable(row, request.campaignId));
  const candidates: ItemCandidate[] = [];
  for (const row of [...runs].sort((a, b) => (a.runId < b.runId ? -1 : 1)))
    for (const item of await source.checklist(row)) candidates.push({ row, item });
  const done = labelledItems(await source.human(), request.reviewerId);
  const open = candidates.filter(({ row, item }) => !done.has(`${row.runId}#${item.id}`));
  const size = validationSampleSize(candidates.length, request.sample);
  const sample = seededShuffle(open, `${request.seed}:sample`).slice(0, size);
  const cases = source.cases();
  const tasks: ItemTask[] = [];
  for (const { row, item } of sample)
    tasks.push({
      ...baseFor(row, cases, request.seed),
      mode: ReviewMode.GraderValidation,
      runId: row.runId,
      item,
      side: await source.side(row),
    });
  return tasks;
}

/** The tasks of one session, in the order the reviewer sees them. */
export async function loadReviewTasks(request: ReviewRequest, source: ReviewSource): Promise<ReviewTask[]> {
  return request.mode === ReviewMode.Pair ? pairTasks(request, source) : itemTasks(request, source);
}

/** A review source over the real ledger and evidence folder. */
export function evidenceReviewSource(
  evidenceRoot: string,
  ledger: Pick<ReviewSource, "runs" | "pairwise" | "human">,
  cases: readonly EvalCase[],
): ReviewSource {
  return {
    ...ledger,
    side: (run) => reviewSide(evidenceRoot, run),
    checklist: (run) => checklistItems(evidenceRoot, run),
    cases: () => cases,
  };
}
