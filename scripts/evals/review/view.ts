/**
 * What the review page is sent: a task as the reviewer may see it, and the codes its controls post
 * back. This is the blinding boundary. A view carries the case text, opaque media URLs and display
 * labels (A and B, or the item and each grader family's verdict), and never a run id, lane, engine,
 * model, campaign or evidence path: a media URL names a random per-session id, not a file.
 */
import { CheckResult, DefectCode, GraderFamily, HumanPick, ItemVerdict } from "../vocabulary.ts";
import type { ReviewMedia, ReviewSide } from "./evidence.ts";
import { ReviewMode, type ItemTask, type PairTask, type ReviewTask } from "./tasks.ts";

/** The words the page shows next to each code. */
const MESSAGE = {
  SideA: "A",
  SideB: "B",
  GradedFrames: "The frames the graders saw",
  PickA: "A is better (A)",
  PickB: "B is better (B)",
  PickTie: "Tie (T)",
  PickInsufficient: "Can't judge (I)",
  VerdictPass: "Pass (P)",
  VerdictFail: "Fail (F)",
  VerdictInconclusive: "Can't tell from the frames (I)",
  SatisfiedUnknown: "Not sure",
  SatisfiedPass: "Yes",
  SatisfiedFail: "No",
  KeyHelp: "Keys: A / B / T / I pick a pair, P / F / I label an item, Enter saves.",
} as const;

/** One image or video as the page loads it. */
export interface MediaView {
  url: string;
  width: number | null;
  height: number | null;
}

/** One side of a task: its display label, the key its answer is filed under, frames and video. */
export interface SideView {
  key: "a" | "b";
  label: string;
  frames: MediaView[];
  video: MediaView | null;
}

/** A blind pair as the page sees it. */
export interface PairView {
  mode: typeof ReviewMode.Pair;
  taskId: string;
  caseLabel: string | null;
  brief: string | null;
  sides: [SideView, SideView];
}

/** A grader-validation item as the page sees it. */
export interface ItemView {
  mode: typeof ReviewMode.GraderValidation;
  taskId: string;
  caseLabel: string | null;
  brief: string | null;
  itemText: string;
  itemKey: boolean;
  verdicts: Array<{ family: GraderFamily; verdict: ItemVerdict }>;
  combined: ItemVerdict;
  side: SideView;
}

/** A labelled code for a button or an option. */
export interface CodeOption<T extends string> {
  value: T;
  label: string;
}

/** The codes the page's controls post back, with their labels and keys. */
export interface SessionCodes {
  modes: { pair: typeof ReviewMode.Pair; graderValidation: typeof ReviewMode.GraderValidation };
  picks: CodeOption<HumanPick>[];
  pickKeys: Record<string, HumanPick>;
  verdicts: CodeOption<ItemVerdict>[];
  verdictKeys: Record<string, ItemVerdict>;
  satisfied: CodeOption<CheckResult>[];
  defaultSatisfied: CheckResult;
  defects: DefectCode[];
  defaultDefect: DefectCode;
  keyHelp: string;
}

/** Everything `GET /api/task` answers: the next task (null when all are done), progress and the codes. */
export interface SessionView {
  task: PairView | ItemView | null;
  progress: { done: number; total: number };
  codes: SessionCodes;
}

/** The session's codes. */
export const SESSION_CODES: SessionCodes = {
  modes: { pair: ReviewMode.Pair, graderValidation: ReviewMode.GraderValidation },
  picks: [
    { value: HumanPick.A, label: MESSAGE.PickA },
    { value: HumanPick.B, label: MESSAGE.PickB },
    { value: HumanPick.Tie, label: MESSAGE.PickTie },
    { value: HumanPick.Insufficient, label: MESSAGE.PickInsufficient },
  ],
  pickKeys: { a: HumanPick.A, b: HumanPick.B, t: HumanPick.Tie, i: HumanPick.Insufficient },
  verdicts: [
    { value: ItemVerdict.Pass, label: MESSAGE.VerdictPass },
    { value: ItemVerdict.Fail, label: MESSAGE.VerdictFail },
    { value: ItemVerdict.Inconclusive, label: MESSAGE.VerdictInconclusive },
  ],
  verdictKeys: { p: ItemVerdict.Pass, f: ItemVerdict.Fail, i: ItemVerdict.Inconclusive },
  satisfied: [
    { value: CheckResult.Unknown, label: MESSAGE.SatisfiedUnknown },
    { value: CheckResult.Pass, label: MESSAGE.SatisfiedPass },
    { value: CheckResult.Fail, label: MESSAGE.SatisfiedFail },
  ],
  defaultSatisfied: CheckResult.Unknown,
  defects: Object.values(DefectCode),
  defaultDefect: DefectCode.None,
  keyHelp: MESSAGE.KeyHelp,
};

/** Turns one piece of media into the URL the page loads it from. */
export type MediaUrl = (media: ReviewMedia) => string;

function sideView(side: ReviewSide, key: SideView["key"], label: string, url: MediaUrl): SideView {
  const view = (media: ReviewMedia): MediaView => ({ url: url(media), width: media.width, height: media.height });
  return { key, label, frames: side.frames.map(view), video: side.video ? view(side.video) : null };
}

function pairView(task: PairTask, taskId: string, url: MediaUrl): PairView {
  return {
    mode: ReviewMode.Pair,
    taskId,
    caseLabel: task.caseText?.label ?? null,
    brief: task.caseText?.brief ?? null,
    sides: [sideView(task.left, "a", MESSAGE.SideA, url), sideView(task.right, "b", MESSAGE.SideB, url)],
  };
}

const FAMILY_ORDER: readonly GraderFamily[] = Object.values(GraderFamily);

function itemView(task: ItemTask, taskId: string, url: MediaUrl): ItemView {
  const verdicts = FAMILY_ORDER.flatMap((family) => {
    const verdict = task.item.verdicts[family];
    return verdict ? [{ family, verdict }] : [];
  });
  return {
    mode: ReviewMode.GraderValidation,
    taskId,
    caseLabel: task.caseText?.label ?? null,
    brief: task.caseText?.brief ?? null,
    itemText: task.item.text,
    itemKey: task.item.key,
    verdicts,
    combined: task.item.combined,
    side: sideView(task.side, "a", MESSAGE.GradedFrames, url),
  };
}

/** The view of one task under its opaque id. */
export function taskView(task: ReviewTask, taskId: string, url: MediaUrl): PairView | ItemView {
  return task.mode === ReviewMode.Pair ? pairView(task, taskId, url) : itemView(task, taskId, url);
}
