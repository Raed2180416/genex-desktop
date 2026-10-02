/**
 * `RunObservation`: the one typed, timestamped timeline every lane's artifacts are normalized into
 * (§7), so each metric is a pure function over the same shape whether the run came from the app's
 * event log, a Claude stream or a Codex stream with sub-agent rollouts. Times are milliseconds
 * after the prompt was submitted, taken from receive timestamps (Rule 12), never from the model's
 * own clock. Types only; the collectors in this folder build it and `metrics.ts` reads it.
 */
import type { EndedHow, LaneModeServed, TokenUsage, ToolCategory } from "../../../src/shared/eval-lane.ts";
import type { ContextSource } from "../../../src/shared/context.ts";
import type { EngineId } from "../../../src/shared/providers.ts";
import type { ProviderUsage } from "../../../src/shared/provider-usage.ts";
import type { EvalLaneReport } from "../../../src/shared/eval-lane.ts";
import type { ProviderNoise, TraceCompleteness } from "../ledger/types.ts";
import type {
  AnswerPolicy,
  BuildSpanKind,
  EvalAgent,
  LifecyclePhase,
  NoBuild,
  ObservationEventKind,
  ObservationSource,
  ObservedErrorKind,
  PreviewSignal,
  QuestionKind,
  ServedModelRole,
} from "../vocabulary.ts";

/** What every timeline event carries: its kind and when it was received. */
interface TimelineBase {
  kind: ObservationEventKind;
  /** Milliseconds after the prompt was submitted, from the receive clock. */
  atMs: number;
  /** Which artifact the event was read from. */
  source: ObservationSource;
}

/** The session a call belongs to: the main session, a worker's, a judge's, or a sub-agent's, by the CLI's own id. */
export interface SessionRef {
  /** The CLI's session or thread id; sub-agent rollouts chain to their parent by `parentSessionId`. */
  sessionId: string;
  parentSessionId: string | null;
  role: ServedModelRole;
}

/** A lifecycle mark: prompt submitted, idle, exited, a rail fired, stopped. */
export interface LifecycleEvent extends TimelineBase {
  kind: typeof ObservationEventKind.Lifecycle;
  phase: LifecyclePhase;
}

/** One model response, deduplicated by its message or response id (Rule 13). */
export interface ModelCallEvent extends TimelineBase {
  kind: typeof ObservationEventKind.ModelCall;
  /** Claude `message.id`, or Codex's response id. */
  id: string;
  session: SessionRef;
  model: string;
  usage: TokenUsage;
  /** The prompt size this call carried, when the source reports it; null otherwise. */
  contextTokens: number | null;
  contextWindow: number | null;
  effortServed: string | null;
  /** When the response ended, when the source reports it. */
  endMs: number | null;
  /** Time to first token, when the source reports it. */
  ttftMs: number | null;
  /** The engine a direct call ran on, when its source records it (the event log's `completion_call`). */
  engine?: string;
}

/** One tool call, classified after `unwrapShell` (Rule 17). */
export interface ToolCallEvent extends TimelineBase {
  kind: typeof ObservationEventKind.ToolCall;
  id: string;
  session: SessionRef;
  name: string;
  category: ToolCategory;
  endMs: number | null;
  /** Whether the tool reported an error; null when the result was never seen. */
  ok: boolean | null;
}

/** A context reading for one session. */
export interface ContextSampleEvent extends TimelineBase {
  kind: typeof ObservationEventKind.ContextSample;
  session: SessionRef;
  tokens: number | null;
  percent: number | null;
  contextSource: ContextSource;
}

/** A compaction of one session's context. */
export interface CompactionEvent extends TimelineBase {
  kind: typeof ObservationEventKind.Compaction;
  session: SessionRef;
}

/** A lane-native "the user could see it" moment. */
export interface PreviewSignalEvent extends TimelineBase {
  kind: typeof ObservationEventKind.PreviewSignal;
  signal: PreviewSignal;
}

/** A chat delegation or a facet build, from request to result. */
export interface BuildSpanEvent extends TimelineBase {
  kind: typeof ObservationEventKind.BuildSpan;
  id: string;
  span: BuildSpanKind;
  endMs: number | null;
  ok: boolean | null;
}

/** The agent asked a question. */
export interface QuestionEvent extends TimelineBase {
  kind: typeof ObservationEventKind.Question;
  id: string;
  question: QuestionKind;
}

/** The lane answered a question under its policy. */
export interface AnswerEvent extends TimelineBase {
  kind: typeof ObservationEventKind.Answer;
  questionId: string;
  policy: AnswerPolicy;
}

/** An error the source reported. */
export interface ErrorEvent extends TimelineBase {
  kind: typeof ObservationEventKind.Error;
  error: ObservedErrorKind;
  httpStatus: number | null;
  session: SessionRef | null;
}

/** A retry the source reported. */
export interface RetryEvent extends TimelineBase {
  kind: typeof ObservationEventKind.Retry;
  attempt: number;
  session: SessionRef | null;
}

/** Any timeline event. */
export type ObservationEvent =
  | LifecycleEvent
  | ModelCallEvent
  | ToolCallEvent
  | ContextSampleEvent
  | CompactionEvent
  | PreviewSignalEvent
  | BuildSpanEvent
  | QuestionEvent
  | AnswerEvent
  | ErrorEvent
  | RetryEvent;

/** The stop-time snapshot's facts. */
export interface SnapshotFacts {
  dir: string;
  files: number;
  bytes: number;
  loc: number;
  hasEntry: boolean;
  buildScript: boolean;
  noBuild: NoBuild | null;
  sha256: string;
}

/** Per-lane metadata about where the observation's facts came from and how trustworthy the trace is. */
export interface ObservationProvenance {
  sources: ObservationSource[];
  /** The stream's own totals, to cross-check the transcript sum (±2%, Rule 13); null without a stream. */
  streamTokens: TokenUsage | null;
  cliVersion: string | null;
  /** The main-loop model the stream reported. */
  servedMain: string | null;
  effortServed: string | null;
  traceComplete: TraceCompleteness;
  providerNoise: ProviderNoise;
  /** The CLI's own cost figure (Claude's `total_cost_usd`), a cross-check only; null when it reports none. */
  cliReportedUsd: number | null;
  /** Per-model totals the CLI reported (Claude's `modelUsage`, including its Haiku helper); empty when none. */
  modelUsage: Record<string, TokenUsage>;
  /** The lane report, Genex lanes only. */
  laneReport: EvalLaneReport | null;
  quotaBefore: ProviderUsage | null;
  quotaAfter: ProviderUsage | null;
}

/**
 * One run as observed: identity, the timeline, the snapshot and the provenance. Every metric in
 * `metrics.ts` is a pure function of this and nothing else.
 */
export interface RunObservation {
  runId: string;
  laneId: string;
  agent: EvalAgent;
  engine: EngineId;
  modelRequested: string;
  modeServed: LaneModeServed | null;
  endedHow: EndedHow;
  /** The wall clock from prompt to idle or exit, from the receive clock. */
  wallMs: number | null;
  timeline: ObservationEvent[];
  snapshot: SnapshotFacts | null;
  provenance: ObservationProvenance;
}
