/**
 * The checklist grader (§8.4): lane-neutral and dual-family. For each applicable acceptance item,
 * each pinned family votes an odd number of times on the witnessed evidence; the families combine by
 * conjunction. It never grades the placeholder (Rule 22): a typed `noBuild` or too little witnessed
 * evidence makes the run `judgeSkipped` with no call made. Pins are checked before the first call.
 */
import { ZERO_TOKEN_USAGE } from "../../../../src/shared/eval-lane.ts";
import type { AcceptanceItem } from "../../case-types.ts";
import type { FamilyVerdicts } from "../../ledger/types.ts";
import type {
  ChecklistGradeRequest,
  ChecklistItemVerdict,
  ChecklistResult,
  GradeChecklist,
  GraderPin,
} from "../types.ts";
import type { GraderComplete } from "./complete.ts";
import { evidenceSufficient, type GraderEvidence, loadGraderEvidence } from "./evidence.ts";
import { validateGraderPins } from "./family.ts";
import { CHECKLIST_PROMPT_SHA, renderChecklistPrompt } from "./prompt.ts";
import { applicableItems, scoreChecklist } from "./score.ts";
import { addUsage, assertVoteCount, combineVerdicts, voteFamily } from "./vote.ts";

/** What the checklist grader is built from. */
export interface ChecklistGraderDeps {
  complete: GraderComplete;
  /** Every evidence file must resolve inside this folder (`$GENEX_EVALS_HOME/evidence`). */
  evidenceRoot: string;
}

/** The grade of a run that was not graded: nothing passed, nothing called. */
function skippedResult(graders: GraderPin[]): ChecklistResult {
  return {
    items: [],
    scoreAllRuns: 0,
    scoreGraded: null,
    inconclusiveRate: 0,
    judgeSkipped: true,
    graderVoid: null,
    graders,
    usage: ZERO_TOKEN_USAGE,
  };
}

/** One item, voted on by every pinned family. */
async function gradeItem(
  deps: ChecklistGraderDeps,
  request: ChecklistGradeRequest,
  evidence: GraderEvidence,
  item: AcceptanceItem,
): Promise<ChecklistItemVerdict> {
  const text = renderChecklistPrompt({
    brief: request.evalCase.brief,
    item,
    consoleSummary: evidence.consoleSummary,
    networkSummary: evidence.networkSummary,
    frameCount: evidence.frames.length,
  });
  const byFamily = [];
  const verdicts: FamilyVerdicts = {};
  for (const pin of request.graders) {
    const votes = await voteFamily({
      complete: deps.complete,
      pin,
      prompt: { text, images: evidence.frames },
      votes: request.votesPerFamily,
      runEngines: [request.runEngine],
    });
    byFamily.push(votes);
    verdicts[pin.family] = votes.verdict;
  }
  return { item, byFamily, verdicts, combined: combineVerdicts(byFamily.map((votes) => votes.verdict)) };
}

/** Build the `GradeChecklist` the campaign and calibration call. */
export function createGradeChecklist(deps: ChecklistGraderDeps): GradeChecklist {
  return async (request: ChecklistGradeRequest): Promise<ChecklistResult> => {
    validateGraderPins(request.graders, CHECKLIST_PROMPT_SHA);
    assertVoteCount(request.votesPerFamily);
    if (request.noBuild !== null) return skippedResult(request.graders);
    const evidence = await loadGraderEvidence(request.evidence, deps.evidenceRoot);
    if (!evidenceSufficient(evidence)) return skippedResult(request.graders);

    const items: ChecklistItemVerdict[] = [];
    for (const item of applicableItems(request.evalCase.acceptance, request.fullAssets)) {
      items.push(await gradeItem(deps, request, evidence, item));
    }
    const usage = items
      .flatMap((entry) => entry.byFamily)
      .reduce((total, votes) => addUsage(total, votes.usage), ZERO_TOKEN_USAGE);
    return { items, ...scoreChecklist(items), judgeSkipped: false, graders: request.graders, usage };
  };
}
