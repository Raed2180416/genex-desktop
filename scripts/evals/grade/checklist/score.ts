/**
 * Checklist scores (§8.4). `scoreAllRuns` (primary) is passed over every scored item of every run:
 * a skipped run and an inconclusive item both count 0. `scoreGraded` (secondary) is passed over the
 * items that got a verdict. The absurd control item is graded but never scored; any family passing
 * it voids the grade (`control-passed`). A void grade keeps its numbers for inspection only.
 */
import type { AcceptanceItem } from "../../case-types.ts";
import type { RowChecklist } from "../../ledger/types.ts";
import { type GraderFamily, GraderVoid, ItemVerdict } from "../../vocabulary.ts";
import type { ChecklistItemVerdict, ChecklistResult } from "../types.ts";

/** The per-run scores a grade carries. */
export interface ChecklistScores {
  scoreAllRuns: number;
  scoreGraded: number | null;
  inconclusiveRate: number;
  graderVoid: GraderVoid | null;
}

/** The items a run is graded on: `full assets only:` items drop out when the run had no assets. */
export function applicableItems(acceptance: readonly AcceptanceItem[], fullAssets: boolean): AcceptanceItem[] {
  return acceptance.filter((item) => fullAssets || !item.assetsOnly);
}

/** How many items count toward a run's score (the control item never does). */
export function scoredItemCount(acceptance: readonly AcceptanceItem[], fullAssets: boolean): number {
  return applicableItems(acceptance, fullAssets).filter((item) => !item.control).length;
}

/** A share, 0 when there is nothing to share over. */
function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/** Whether any family passed the control item: the grader says yes to anything, so the grade is void. */
function controlPassed(items: readonly ChecklistItemVerdict[]): boolean {
  return items.some(
    (entry) => entry.item.control && entry.byFamily.some((family) => family.verdict === ItemVerdict.Pass),
  );
}

/** One run's scores from its item verdicts. */
export function scoreChecklist(items: readonly ChecklistItemVerdict[]): ChecklistScores {
  const scored = items.filter((entry) => !entry.item.control);
  const passed = scored.filter((entry) => entry.combined === ItemVerdict.Pass).length;
  const inconclusive = scored.filter((entry) => entry.combined === ItemVerdict.Inconclusive).length;
  const graded = scored.length - inconclusive;
  return {
    scoreAllRuns: share(passed, scored.length),
    scoreGraded: graded === 0 ? null : passed / graded,
    inconclusiveRate: share(inconclusive, scored.length),
    graderVoid: controlPassed(items) ? GraderVoid.ControlPassed : null,
  };
}

/** One run's grade, with how many items it was scored over (skipped runs have no item verdicts). */
export interface ScoredRun {
  result: ChecklistResult;
  scoredItems: number;
}

/** Scores across runs of one cell: the primary counts skipped runs' items as 0. Void grades are left out. */
export interface AggregateScores {
  runs: number;
  scoreAllRuns: number;
  scoreGraded: number | null;
  judgeSkippedRate: number;
  inconclusiveRate: number;
}

/** Aggregate scores over runs; a void grade is excluded and a skipped run counts its items as 0. */
export function aggregateChecklistScores(runs: readonly ScoredRun[]): AggregateScores {
  const kept = runs.filter((run) => run.result.graderVoid === null);
  let all = 0;
  let passed = 0;
  let graded = 0;
  let inconclusive = 0;
  for (const { result, scoredItems } of kept) {
    all += scoredItems;
    for (const entry of result.items.filter((item) => !item.item.control)) {
      if (entry.combined === ItemVerdict.Pass) passed += 1;
      if (entry.combined === ItemVerdict.Inconclusive) inconclusive += 1;
      else graded += 1;
    }
  }
  return {
    runs: kept.length,
    scoreAllRuns: share(passed, all),
    scoreGraded: graded === 0 ? null : passed / graded,
    judgeSkippedRate: share(kept.filter((run) => run.result.judgeSkipped).length, kept.length),
    inconclusiveRate: share(inconclusive, all),
  };
}

/** A family's counts over the scored items of one run. */
function familyCounts(items: readonly ChecklistItemVerdict[], family: GraderFamily) {
  const counts = { passed: 0, graded: 0, inconclusive: 0 };
  for (const entry of items.filter((item) => !item.item.control)) {
    const verdict = entry.verdicts[family];
    if (verdict === undefined) continue;
    if (verdict === ItemVerdict.Inconclusive) counts.inconclusive += 1;
    else counts.graded += 1;
    if (verdict === ItemVerdict.Pass) counts.passed += 1;
  }
  return counts;
}

/** The ledger's `checklist` section for one run's grade. */
export function toRowChecklist(result: ChecklistResult): RowChecklist {
  const byFamily: RowChecklist["byFamily"] = {};
  for (const pin of result.graders) byFamily[pin.family] = familyCounts(result.items, pin.family);
  return {
    scoreAllRuns: result.scoreAllRuns,
    scoreGraded: result.scoreGraded,
    byFamily,
    inconclusiveRate: result.inconclusiveRate,
    judgeSkipped: result.judgeSkipped,
    graderVoid: result.graderVoid,
  };
}
