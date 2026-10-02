/**
 * The rows a human review writes (§8.6, §10.7), as `genex-evals/human/1`. A blind pair review names
 * the run shown as A (left) and as B (right), the reviewer's pick, the decisive defect and whether
 * each side satisfied the request. A grader-validation label names one run's checklist item, both
 * families' verdicts as the graders gave them, and the owner's own verdict from the same frames;
 * it carries no pick and no request answers (the ledger's `HumanRow.item`).
 */
import { type FamilyVerdicts, HUMAN_ROW_SCHEMA, type HumanItemLabel, type HumanRow } from "../ledger/types.ts";
import type { CheckResult, DefectCode, HumanPick, ItemVerdict } from "../vocabulary.ts";

/** A grader-validation label as a human row: one run on both sides, no pick, and the item label. */
export type GraderValidationRow = HumanRow & { pick: null; requestSatisfied: null; item: HumanItemLabel };

/** Any row the review writes or reads back. */
export type ReviewRow = HumanRow;

/** What every review row shares: where it belongs, who reviewed and how long it took. */
export interface ReviewRowBase {
  campaignId: string;
  caseId: string;
  caseVersion: string;
  reviewerId: string;
  placementSeed: string;
  recordedAt: string;
  reviewSeconds: number | null;
}

/** A blind pair review: `left` was shown as A, `right` as B. */
export interface PairAnswer {
  leftRunId: string;
  rightRunId: string;
  pick: HumanPick;
  defect: DefectCode;
  satisfied: { a: CheckResult; b: CheckResult };
}

/** A grader-validation answer on one item of one run. */
export interface ItemAnswer {
  runId: string;
  itemId: string;
  verdicts: FamilyVerdicts;
  human: ItemVerdict;
  defect: DefectCode;
}

/** The human row for one blind pair review. */
export function pairReviewRow(base: ReviewRowBase, answer: PairAnswer): HumanRow {
  return {
    schema: HUMAN_ROW_SCHEMA,
    campaignId: base.campaignId,
    recordedAt: base.recordedAt,
    caseId: base.caseId,
    caseVersion: base.caseVersion,
    reviewerId: base.reviewerId,
    runIds: { a: answer.leftRunId, b: answer.rightRunId },
    placementSeed: base.placementSeed,
    pick: answer.pick,
    defect: answer.defect,
    requestSatisfied: { a: answer.satisfied.a, b: answer.satisfied.b },
    reviewSeconds: base.reviewSeconds,
  };
}

/** The human row for one grader-validation label: the run on both sides, the item and both verdicts. */
export function graderValidationRow(base: ReviewRowBase, answer: ItemAnswer): GraderValidationRow {
  return {
    schema: HUMAN_ROW_SCHEMA,
    campaignId: base.campaignId,
    recordedAt: base.recordedAt,
    caseId: base.caseId,
    caseVersion: base.caseVersion,
    reviewerId: base.reviewerId,
    runIds: { a: answer.runId, b: answer.runId },
    placementSeed: base.placementSeed,
    pick: null,
    defect: answer.defect,
    requestSatisfied: null,
    reviewSeconds: base.reviewSeconds,
    item: { id: answer.itemId, verdicts: { ...answer.verdicts }, human: answer.human },
  };
}

/** The item id a human row labels, or null for a blind pair review. */
export function labelledItemId(row: HumanRow): string | null {
  return row.item?.id ?? null;
}
