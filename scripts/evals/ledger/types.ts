/**
 * The eval ledger's row schemas (§9.1, Appendix A), closed: every string is a code from
 * `vocabulary.ts` or matches a field-specific pattern below, and every map has a closed key set.
 * `Pinned<T>` says why a value is missing instead of pretending it is zero (Rule 2): `unavailable`
 * refuses comparison, `na` compares equal. The writer, reader, guard and hash live beside this file.
 */
import type {
  EndedHow,
  LaunchPath,
  LaneModeServed,
  TokenRole,
  TokenUsage,
  ToolCategory,
} from "../../../src/shared/eval-lane.ts";
import type { PermissionMode } from "../../../src/shared/permissions.ts";
import type { EngineId } from "../../../src/shared/providers.ts";
import type { CompletionPolicy, ExecutionStatus } from "../../../src/shared/run-state.ts";
import type {
  AccountExclusive,
  Axis,
  BrowserPin,
  BuildSpanKind,
  CampaignVoidReason,
  CaseExposure,
  CaseVisibility,
  CheckResult,
  Concurrency,
  ContainmentPin,
  Coverage,
  DefectCode,
  EvalAgent,
  GraderFamily,
  GraderVoid,
  HardwareClass,
  HarnessFailure,
  HumanPick,
  ItemVerdict,
  LaneMode,
  NetworkPin,
  NoBuild,
  NoteCode,
  PairFacet,
  PairOrder,
  PairPick,
  ProbeRow,
  RendererMode,
  RowKind,
  ServedModelRole,
  ShimMode,
  UnavailableReason,
} from "../vocabulary.ts";

/** The run row's schema id. */
export const RUN_ROW_SCHEMA = "genex-evals/run/1";
/** The pairwise row's schema id (local ledger only). */
export const PAIRWISE_ROW_SCHEMA = "genex-evals/pairwise/1";
/** The human review row's schema id (local ledger only). */
export const HUMAN_ROW_SCHEMA = "genex-evals/human/1";

/** `<yyyymmddThhmmss>-<lane>-<case>-r<rep>`. */
export const RUN_ID_PATTERN = /^\d{8}T\d{6}-[a-z0-9-]{3,40}-[a-z0-9-]{1,40}-r\d+$/;
/** `<yyyymmddThhmmss>-<label>`. */
export const CAMPAIGN_ID_PATTERN = /^\d{8}T\d{6}-[a-z0-9-]{1,40}$/;
/** A case, lane or grade id: lowercase kebab. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A full sha256 digest. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** A short digest, as `case.version` and `gradeId` carry (sha256[:12]). */
export const SHORT_DIGEST_PATTERN = /^[0-9a-f]{12}$/;
/** A model id as a provider spells it. */
export const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{1,63}$/;
/** A CLI version, `2.1.284` or `0.159.0-beta.1`. */
export const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?$/;
/** `${platform}-${release}`, as `os` records it. */
export const OS_PATTERN = /^[a-z0-9]+-[\w.-]{1,40}$/;
/** An ISO-8601 UTC instant with second precision. */
export const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** The price table's date, as `cost.priceTable` records it. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A value that was measured, could not be (`unavailable`, with a typed reason), or does not apply to this lane (`na`). */
export type Pinned<T> = T | { unavailable: true; reason: UnavailableReason } | { na: true };

/** A `Pinned` that could not be measured. */
export const unavailable = (reason: UnavailableReason): { unavailable: true; reason: UnavailableReason } => ({
  unavailable: true,
  reason,
});

/** The `Pinned` that does not apply to this lane; it compares equal. */
export const NOT_APPLICABLE: { na: true } = { na: true };

/** Whether a pinned value is a measurement (neither unavailable nor n/a). */
export function isMeasured<T>(value: Pinned<T>): value is T {
  if (value === null || typeof value !== "object") return true;
  return !("unavailable" in value) && !("na" in value);
}

/** The case a row belongs to, by frozen version. */
export interface RowCase {
  id: string;
  version: string;
  checklistVersion: string;
  exposure: CaseExposure;
  visibility: CaseVisibility;
}

/** The lane a row ran in (Rule 6: rows from different lanes never average). */
export interface RowLane {
  id: string;
  agent: EvalAgent;
  engine: EngineId;
  mode: LaneMode;
  modeServed: LaneModeServed | null;
  /** The digest of the lane's flags, instructions and workspace prep. */
  harnessPin: string;
  network: NetworkPin;
  browser: BrowserPin;
  containment: ContainmentPin;
}

/** One model the run was served by, with its role and the tokens it used when attributable. */
export interface ServedModel {
  id: string;
  role: ServedModelRole;
  tokens: TokenUsage | null;
}

/** Which models the run asked for and got (Rule 16). */
export interface RowModel {
  requested: string;
  /** The main-loop model the stream reported; null when it never said (then `served-model-mismatch` cannot fire). */
  main: string | null;
  served: ServedModel[];
  effort: string;
  effortServed: Pinned<string>;
}

/** Run pins: they must match for two rows to compare (§9.1). Genex-only pins are `na` on raw lanes. */
export interface RunPins {
  appSha: Pinned<string>;
  buildId: Pinned<string>;
  harnessSeedDigest: Pinned<string>;
  cliVersion: Pinned<string>;
  laneWrapperDigest: string;
  containmentDigest: string;
  instructionSha: string;
}

/** Grading pins: fixed by `regrade`, never by a run. */
export interface GradingPins {
  proberVersion: Pinned<string>;
  soakMs: Pinned<number>;
  graderPromptSha: Pinned<string>;
  graderModels: string[];
  pairwiseRubricSha: Pinned<string>;
  shimMode: ShimMode;
  rendererMode: Pinned<RendererMode>;
  endpointsSha: string;
}

/** Recorded, never compared. */
export interface RecordedPins {
  evalSha: string;
  appDirty: boolean;
  os: string;
  hardwareClass: HardwareClass;
  concurrency: Concurrency;
  coRunLane: string | null;
  interleaveSeed: string;
  accountExclusive: AccountExclusive;
}

/** Whether the trace was read whole (Rule 3): a dirty trace makes judgement metrics unknown. */
export interface TraceCompleteness {
  parseFailures: number;
  truncatedTail: boolean;
}

/** Provider noise the trace showed (Rule 3). */
export interface ProviderNoise {
  apiErrors: number;
  retries: number;
  /** The last HTTP status a typed provider error reported, or null when none did. */
  apiErrorStatus: number | null;
}

/** How the run ended and what the guards said. */
export interface RowOutcome {
  endedHow: EndedHow;
  harnessFailure: HarnessFailure | null;
  noBuild: NoBuild | null;
  questionsAsked: number;
  answersGiven: number;
  traceComplete: TraceCompleteness;
  providerNoise: ProviderNoise;
}

/** One build span inside a Genex run. */
export interface BuildSpan {
  kind: BuildSpanKind;
  ms: number;
}

/** Timing (§7); censored values are null and the coverage says why. */
export interface RowTime {
  wallMs: number | null;
  /** `wallMs` when `endedHow` is `agent-finished`, else null (censored). */
  toDoneMs: number | null;
  firstBootMs: number | null;
  firstPlayableMs: number | null;
  /** The snapshot interval the first-playable search resolved to. */
  firstPlayableResolutionMs: number | null;
  firstPreviewMs: number | null;
  delegationP50Ms: number | null;
  builds: BuildSpan[];
  coverage: Coverage;
}

/** Token totals with the split by role and by model (Rule 13). */
export interface RowTokens extends TokenUsage {
  byRole: Partial<Record<TokenRole, TokenUsage>>;
  byModel: Record<string, TokenUsage>;
  coverage: Coverage;
}

/** Context peaks and compactions. */
export interface RowContext {
  leadPeakPct: number | null;
  leadPeakTokens: number | null;
  workersPeakPct: number | null;
  compactions: number | null;
  coverage: Coverage;
}

/** Model and tool call counts, and the process signals `analyzeRun` derives. */
export interface RowCalls {
  modelCalls: number | null;
  tools: { total: number | null; byCategory: Partial<Record<ToolCategory, number>> };
  blindEditStreak: number | null;
  subagents: number | null;
  /** `!(edits ≥ 10 && builds == 0)`, gated on `agent-finished` and a clean trace. */
  verifiedBeforeDone: boolean | null;
  coverage: Coverage;
}

/** One quota window before and after the run (descriptive unless `accountExclusive` is attested). */
export interface QuotaDelta {
  windowId: string;
  before: number | null;
  after: number | null;
  resetsAtBefore: string | null;
  resetsAtAfter: string | null;
  resetInside: boolean;
}

/** Cost (Rule 15): API-equivalent for every lane, marked as an estimate; subscription runs bill nothing. */
export interface RowCost {
  apiEquivalentUsd: Pinned<number>;
  priceTable: string;
  cliReportedUsd: number | null;
  billed: number | null;
  quota: QuotaDelta[];
}

/** What the stop-time snapshot held. */
export interface RowOutput {
  files: number;
  bytes: number;
  loc: number;
  hasEntry: boolean;
  buildScript: boolean;
  validate: CheckResult;
}

/** The prober's rows and gates (§8.2). */
export interface RowProbe {
  l1Gate: CheckResult;
  l2Gate: CheckResult;
  rows: Partial<Record<ProbeRow, CheckResult>>;
  firstRenderMs: number | null;
  fpsMedian: number | null;
  consoleErrors: number | null;
  soakMs: Pinned<number>;
  /** A quick grade can never be promoted or used by `check`. */
  quick: boolean;
}

/** The checklist grade (§8.4). */
export interface RowChecklist {
  scoreAllRuns: number;
  scoreGraded: number | null;
  byFamily: Partial<Record<GraderFamily, { passed: number; graded: number; inconclusive: number }>>;
  inconclusiveRate: number;
  judgeSkipped: boolean;
  graderVoid: GraderVoid | null;
}

/** In-app judge signals (§8.7), Genex lanes only, compared within a lane over versions. */
export interface RowInApp {
  mode: LaneModeServed;
  launch: LaunchPath;
  budgets: { completionPolicy: CompletionPolicy | null; wallClockMs: number | null; untilSatisfied: boolean | null };
  permissionMode: PermissionMode;
  victory: boolean | null;
  executionStatus: ExecutionStatus | null;
  stopCode: string | null;
  livenessMax: number | null;
  scoreboard: { passing: number; total: number; regressions: number } | null;
  judgeCalls: number | null;
  judgeTokens: TokenUsage | null;
  inAppRubricDigest: string;
}

/** Digests of the evidence a row was computed from. */
export interface RowDigests {
  streamSha256: string | null;
  transcriptSha256: string | null;
  snapshotSha256: string | null;
  evidenceSha256: string | null;
}

/** One run, graded `gradeSeq` times; `currentRows()` keeps the latest grade per run (Rule 10). */
export interface RunRow {
  schema: typeof RUN_ROW_SCHEMA;
  runId: string;
  campaignId: string;
  recordedAt: string;
  gradeSeq: number;
  gradeId: string;
  kind: RowKind;
  campaignVoid: CampaignVoidReason | null;
  /** The replacement rep's runId when this harness-failure row was replaced (§10.5). */
  supersededBy: string | null;
  case: RowCase;
  lane: RowLane;
  model: RowModel;
  pins: { run: RunPins; grading: GradingPins; recorded: RecordedPins };
  outcome: RowOutcome;
  time: RowTime;
  tokens: RowTokens;
  context: RowContext;
  calls: RowCalls;
  cost: RowCost;
  output: RowOutput;
  probe: RowProbe | null;
  checklist: RowChecklist | null;
  inApp: RowInApp | null;
  digests: RowDigests;
  notes: NoteCode[];
}

/** One pairwise verdict: one (pair, family, order); both orders are judged (§8.5). Local ledger only. */
export interface PairwiseRow {
  schema: typeof PAIRWISE_ROW_SCHEMA;
  campaignId: string;
  recordedAt: string;
  gradeSeq: number;
  gradeId: string;
  caseId: string;
  caseVersion: string;
  rep: number;
  axis: Axis;
  /** The pair's lanes in axis order (A before B); `order` says which the judge saw on the left. */
  lanes: { first: string; second: string };
  runIds: { first: string; second: string };
  order: PairOrder;
  blindSeed: string;
  family: GraderFamily;
  graderModel: string;
  /** Whether the grader's family is one of the pair's model families. */
  sameFamily: boolean;
  pairwiseRubricSha: string;
  picks: Record<PairFacet, PairPick>;
  judgeSkipped: boolean;
  /**
   * Set when the pair was decided without a call because exactly one side shipped a typed no-build:
   * the picks point at the side that built. Absent on judged rows and on rows written before it.
   */
  forfeit?: boolean;
}

/** The owner's label on one checklist item (§10.7): each family's verdict as the grader gave it, and the owner's own. */
export interface HumanItemLabel {
  /** The acceptance item id, `<case>-<nn>`. */
  id: string;
  verdicts: FamilyVerdicts;
  /** The owner's verdict from the frames: `inconclusive` when the evidence cannot show it. */
  human: ItemVerdict;
}

/** One human review (local ledger only): a blind pair (§8.6), or a grader-validation label on one checklist item (§10.7). */
export interface HumanRow {
  schema: typeof HUMAN_ROW_SCHEMA;
  campaignId: string;
  recordedAt: string;
  caseId: string;
  caseVersion: string;
  /** An opaque local reviewer id; never a name or an email. */
  reviewerId: string;
  /** A pair's run shown as A (left) and as B (right); a label names its one run on both sides. */
  runIds: { a: string; b: string };
  placementSeed: string;
  /** Null on a grader-validation label. */
  pick: HumanPick | null;
  defect: DefectCode;
  /** Null on a grader-validation label. */
  requestSatisfied: { a: CheckResult; b: CheckResult } | null;
  /** Seconds the review took, for the "cheap enough to do" measurement. */
  reviewSeconds: number | null;
  /** Present only on a grader-validation label. A pair review has no such key, so rows written before this field stay valid. */
  item?: HumanItemLabel;
}

/** Any row a ledger file holds. */
export type LedgerRow = RunRow | PairwiseRow | HumanRow;

/** The digest fields an `ItemVerdict` row carries per family; kept here so the grader and the ledger agree. */
export type FamilyVerdicts = Partial<Record<GraderFamily, ItemVerdict>>;
