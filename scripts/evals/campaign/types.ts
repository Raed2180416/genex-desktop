/**
 * The campaign contract (§4, §12): what `campaign plan` writes to
 * `$GENEX_EVALS_HOME/campaigns/<campaignId>/campaign.json` and `campaign run` reads back. A plan is
 * the matrix (cases × lanes × reps, and × apps for Genex lanes on the version axis), split into one
 * stream per provider account (Rule 21), each stream's builds in a seeded order and bracketed by
 * canaries (Rule 20). Replacement reps (§10.5) are never planned: they are derived from the ledger.
 */
import type { EngineId } from "../../../src/shared/providers.ts";
import type { CaseVisibility, GraderFamily, RowKind } from "../vocabulary.ts";

/** The campaign file's schema id. */
export const CAMPAIGN_SCHEMA = "genex-evals/campaign/1";
/** The plan's file inside a campaign's folder. */
export const CAMPAIGN_FILE = "campaign.json";
/** The case every canary runs (C8); canaries are added automatically, never listed in `--cases`. */
export const CANARY_CASE_ID = "canary";

/** Which app a Genex run evaluates on the version axis (`--apps base,cand`): the first SHA or the second. */
export const AppRole = {
  Base: "base",
  Candidate: "cand",
} as const;
export type AppRole = (typeof AppRole)[keyof typeof AppRole];

/** Where a canary sits in its stream: first (with one planned retry), or last. */
export const CanaryBracket = {
  Opening: "opening",
  OpeningRetry: "opening-retry",
  Closing: "closing",
} as const;
export type CanaryBracket = (typeof CanaryBracket)[keyof typeof CanaryBracket];

/** The rep number each canary bracket runs as, so its runId never collides with another. */
export const CANARY_REP: Readonly<Record<CanaryBracket, number>> = {
  [CanaryBracket.Opening]: 1,
  [CanaryBracket.OpeningRetry]: 2,
  [CanaryBracket.Closing]: 3,
};

/** One app build a campaign evaluates: its role on the version axis and its full commit SHA. */
export interface PlannedApp {
  role: AppRole;
  sha: string;
}

/** One planned run: a build rep or a canary, in one lane, on one case, for one app (Genex lanes only). */
export interface PlannedRun {
  runId: string;
  kind: RowKind;
  laneId: string;
  caseId: string;
  rep: number;
  app: PlannedApp | null;
  bracket: CanaryBracket | null;
}

/** The runs one provider account executes, strictly one at a time (Rule 21). */
export interface ProviderStream {
  engine: EngineId;
  opening: PlannedRun[];
  builds: PlannedRun[];
  closing: PlannedRun[];
}

/** The case as the plan froze it; `run` refuses when the case file moved under it. */
export interface PlannedCase {
  id: string;
  version: string;
  visibility: CaseVisibility;
  deadlineMin: number;
}

/** The lane as the plan froze it; `run` refuses when its flags digest moved under it. */
export interface PlannedLane {
  id: string;
  engine: EngineId;
  flagsDigest: string;
}

/** What the plan expects the campaign to cost, printed before anything runs. */
export interface CampaignEstimates {
  builds: number;
  canaries: number;
  /** Deadline plus grace summed over each stream's runs (the opening retries left out). */
  buildHoursByStream: Partial<Record<EngineId, number>>;
  /** Streams overlap unless `--serial`, so the wall time is the longest stream. */
  buildHoursWall: number;
  /** Checklist votes plus pairwise judgements, per grader family (§8.4, §8.5). */
  gradingCallsByFamily: Partial<Record<GraderFamily, number>>;
  /** Provider quota windows each stream spans at least. */
  quotaWindowsByStream: Partial<Record<EngineId, number>>;
}

/** A planned campaign, as `campaign.json` holds it. */
export interface CampaignPlan {
  schema: typeof CAMPAIGN_SCHEMA;
  campaignId: string;
  createdAt: string;
  /** The seed every stream's order is drawn from (`interleaveSeed` on each row). */
  seed: string;
  reps: number;
  /** The deadline every case gets when `--deadline-min` was given; null keeps each case's own. */
  deadlineMin: number | null;
  apps: PlannedApp[];
  cases: PlannedCase[];
  lanes: PlannedLane[];
  streams: ProviderStream[];
  estimates: CampaignEstimates;
}
