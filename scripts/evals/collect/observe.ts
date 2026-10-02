/**
 * Builds the contract's `RunObservation` (`observation.ts`, types only) from whatever sources a
 * lane left: a Claude or Codex stream, the eval homes' transcripts, the Genex event log, the lane
 * report and the stop-time snapshot. One rule per overlap, so nothing is counted twice:
 *
 * - model calls come from the transcripts when they have any (Rule 13), else from the stream
 *   (`stream-only`); the Genex event log's judge calls (`completion_call`) are added unless the
 *   transcripts already hold the critics' own sessions and the call's engine writes one (a Codex
 *   judge runs `--ephemeral`, so its logged call is always added); what a model's reported totals
 *   hold beyond the calls naming it (Claude Code's Haiku helper) is added once per model as an
 *   `auxiliary` aggregate call, the totals being the stream's `modelUsage` on a raw lane and the
 *   event log's `Usage.by_model` on a Genex lane (one rule for both, Rule 13);
 * - compactions come from the stream when it has any, else the event log, else the transcripts;
 * - tool calls come from the stream (raw lanes) or the event log (Genex lanes), plus the Codex
 *   sub-agents' calls, which only their rollouts hold.
 */
import type { EndedHow, EvalLaneReport, LaneModeServed, TokenUsage } from "../../../src/shared/eval-lane.ts";
import { untaggedModelId } from "../../../src/shared/model-id.ts";
import { EngineId } from "../../../src/shared/providers.ts";
import type { ProviderUsage } from "../../../src/shared/provider-usage.ts";
import { providerNoise, traceComplete, type TraceReading } from "./honesty.ts";
import type { ModelCallEvent, ObservationEvent, RunObservation, SnapshotFacts } from "./observation.ts";
import { promptTokens, residualUsage, totalTokens } from "./usage.ts";
import {
  LifecyclePhase,
  ObservationEventKind,
  ObservationSource,
  ServedModelRole,
  type EvalAgent,
} from "../vocabulary.ts";

/** One model's totals as a CLI reported them, with its context window when known. */
export interface ModelUsageReading {
  usage: TokenUsage;
  contextWindow: number | null;
}

/** A lane's stream, read: what `claude-stream.ts` and `codex-stream.ts` return. */
export interface StreamReading {
  /** The CLI's main session or thread id. */
  sessionId: string | null;
  events: ObservationEvent[];
  servedMain: string | null;
  effortServed: string | null;
  cliVersion: string | null;
  /** The stream's own main-loop totals, for the ±2% cross-check. */
  streamTokens: TokenUsage | null;
  cliReportedUsd: number | null;
  /** Per-model totals the CLI reported (Claude `modelUsage`); empty when it reports none. */
  modelUsage: Record<string, ModelUsageReading>;
  trace: TraceReading;
  /** The last line's receive time, in milliseconds after the prompt. */
  lastAtMs: number | null;
}

/** Any other source's events and completeness (transcripts, the event log). */
export interface TimelineReading {
  events: ObservationEvent[];
  trace: TraceReading;
  servedMain?: string | null;
  effortServed?: string | null;
  cliVersion?: string | null;
  /** Transcripts only: how many counted sessions are critics (`judge:*`), whose own transcripts hold their calls. */
  criticSessions?: number;
  /** Event log only: every model's totals the app's engine calls recorded (`Usage.by_model`). */
  modelUsage?: Record<string, ModelUsageReading>;
}

/** Everything one run left behind, read. */
export interface ObservationInput {
  runId: string;
  laneId: string;
  agent: EvalAgent;
  engine: EngineId;
  modelRequested: string;
  modeServed: LaneModeServed | null;
  endedHow: EndedHow;
  /** Epoch ms the prompt was submitted; every `atMs` is after it. */
  promptAtMs: number;
  /** Epoch ms the lane went idle or exited, from the runner's clock; null falls back to the stream's last line. */
  endAtMs: number | null;
  stream: StreamReading | null;
  transcripts: TimelineReading | null;
  eventLog: TimelineReading | null;
  laneReport: EvalLaneReport | null;
  snapshot: SnapshotFacts | null;
  quotaBefore: ProviderUsage | null;
  quotaAfter: ProviderUsage | null;
}

/** Engines whose direct `complete()` calls write no transcript (`codex exec --ephemeral`): the event log is their only record. */
const UNTRANSCRIBED_COMPLETIONS: ReadonlySet<string> = new Set([EngineId.Codex]);

/** The id prefix of an aggregate call built from a CLI's per-model totals; `calls.modelCalls` leaves these out. */
export const AUXILIARY_CALL_PREFIX = "model-usage:";

const isKind =
  <K extends ObservationEvent["kind"]>(kind: K) =>
  (event: ObservationEvent): event is Extract<ObservationEvent, { kind: K }> =>
    event.kind === kind;
const isModelCall = isKind(ObservationEventKind.ModelCall);
const isCompaction = isKind(ObservationEventKind.Compaction);

/** The source that owns compactions: the stream, else the event log, else the transcripts. */
function compactionsOf(input: ObservationInput): ObservationEvent[] {
  for (const source of [input.stream, input.eventLog, input.transcripts]) {
    const found = source?.events.filter(isCompaction) ?? [];
    if (found.length) return found;
  }
  return [];
}

/**
 * The judges' direct calls the Genex event log recorded (`completion_call`), less those the
 * transcripts already hold: a critic's own session (`judge:*`) is a transcript only when its engine
 * writes one, so a Codex call is always kept and the playtester's rollout never stands in for it.
 */
function eventLogJudges(input: ObservationInput): ModelCallEvent[] {
  const judges = (input.eventLog?.events.filter(isModelCall) ?? []).filter(
    (call) => call.session.role === ServedModelRole.Judge,
  );
  if (!input.transcripts?.criticSessions) return judges;
  return judges.filter((call) => UNTRANSCRIBED_COMPLETIONS.has(call.engine ?? ""));
}

/** The per-model totals the lane reported: a raw lane's stream, else a Genex lane's event log. */
function modelTotalsOf(input: ObservationInput): {
  source: ObservationSource;
  totals: Record<string, ModelUsageReading>;
} {
  if (input.stream) return { source: ObservationSource.Stream, totals: input.stream.modelUsage };
  return { source: ObservationSource.EventLog, totals: input.eventLog?.modelUsage ?? {} };
}

/** The model calls: the transcripts' when they have any, else the stream's; plus the judges' logged calls no transcript holds. */
function modelCallsOf(input: ObservationInput): ModelCallEvent[] {
  const fromTranscripts = input.transcripts?.events.filter(isModelCall) ?? [];
  const primary = fromTranscripts.length ? fromTranscripts : (input.stream?.events.filter(isModelCall) ?? []);
  const calls = [...primary, ...eventLogJudges(input)];
  const windows = modelTotalsOf(input).totals;
  return calls.map((call) => ({
    ...call,
    contextWindow: call.contextWindow ?? windows[untaggedModelId(call.model)]?.contextWindow ?? null,
  }));
}

/**
 * One aggregate `auxiliary` call per model whose reported totals hold more than the calls naming
 * it: the remainder, field by field (Rule 16: recorded, never failing). A model a sub-agent also
 * called keeps its helper share; totals equal to the calls add nothing. Ids match untagged
 * (`untaggedModelId`), so a `[1m]` total and its bare calls are one model.
 */
function auxiliaryCalls(input: ObservationInput, calls: readonly ModelCallEvent[], atMs: number): ModelCallEvent[] {
  const { source, totals } = modelTotalsOf(input);
  const sessionId = input.stream?.sessionId ?? "";
  return Object.entries(totals).flatMap(([reported, reading]): ModelCallEvent[] => {
    const model = untaggedModelId(reported);
    const named = calls.filter((call) => untaggedModelId(call.model) === model).map((call) => call.usage);
    const usage = residualUsage(reading.usage, named);
    if (totalTokens(usage) === 0) return [];
    return [
      {
        kind: ObservationEventKind.ModelCall,
        atMs,
        source,
        id: `${AUXILIARY_CALL_PREFIX}${model}`,
        session: { sessionId, parentSessionId: sessionId, role: ServedModelRole.Auxiliary },
        model,
        usage,
        contextTokens: promptTokens(usage),
        contextWindow: reading.contextWindow,
        effortServed: null,
        endMs: null,
        ttftMs: null,
      },
    ];
  });
}

function otherEvents(input: ObservationInput): ObservationEvent[] {
  const keep = (event: ObservationEvent) => !isModelCall(event) && !isCompaction(event);
  return [input.stream, input.transcripts, input.eventLog].flatMap((source) => source?.events.filter(keep) ?? []);
}

function laneEvents(input: ObservationInput, wallMs: number | null): ObservationEvent[] {
  const source = input.laneReport ? ObservationSource.LaneReport : ObservationSource.Stream;
  const events: ObservationEvent[] = [
    { kind: ObservationEventKind.Lifecycle, atMs: 0, source, phase: LifecyclePhase.PromptSubmitted },
  ];
  if (wallMs !== null)
    events.push({ kind: ObservationEventKind.Lifecycle, atMs: wallMs, source, phase: LifecyclePhase.Exited });
  for (const answer of input.laneReport?.answers ?? []) {
    events.push({
      kind: ObservationEventKind.Answer,
      atMs: answer.atMs,
      source: ObservationSource.LaneReport,
      questionId: answer.questionId,
      policy: answer.policy,
    });
  }
  return events;
}

function sourcesOf(input: ObservationInput): ObservationSource[] {
  const sources: ObservationSource[] = [];
  if (input.stream) sources.push(ObservationSource.Stream);
  if (input.transcripts) sources.push(ObservationSource.Transcript);
  if (input.eventLog) sources.push(ObservationSource.EventLog);
  if (input.laneReport) sources.push(ObservationSource.LaneReport);
  if (input.snapshot) sources.push(ObservationSource.Snapshot);
  return sources;
}

function wallOf(input: ObservationInput): number | null {
  if (input.endAtMs !== null) return Math.max(0, input.endAtMs - input.promptAtMs);
  return input.stream?.lastAtMs ?? null;
}

/** One run's artifacts as the typed timeline every metric reads, events in receive order. */
export function buildRunObservation(input: ObservationInput): RunObservation {
  const wallMs = wallOf(input);
  const calls = modelCallsOf(input);
  const timeline = [
    ...laneEvents(input, wallMs),
    ...calls,
    ...auxiliaryCalls(input, calls, wallMs ?? 0),
    ...compactionsOf(input),
    ...otherEvents(input),
  ].sort((a, b) => a.atMs - b.atMs);
  const readings = [input.stream, input.transcripts, input.eventLog].flatMap((source) =>
    source ? [source.trace] : [],
  );
  const report = input.laneReport;
  return {
    runId: input.runId,
    laneId: input.laneId,
    agent: input.agent,
    engine: input.engine,
    modelRequested: input.modelRequested,
    modeServed: input.modeServed,
    endedHow: input.endedHow,
    wallMs,
    timeline,
    snapshot: input.snapshot,
    provenance: {
      sources: sourcesOf(input),
      streamTokens: input.stream?.streamTokens ?? null,
      cliVersion: input.stream?.cliVersion ?? input.transcripts?.cliVersion ?? null,
      servedMain: input.stream?.servedMain ?? input.transcripts?.servedMain ?? report?.modelServed ?? null,
      effortServed: input.stream?.effortServed ?? input.transcripts?.effortServed ?? report?.effortServed ?? null,
      traceComplete: traceComplete(readings, input.endedHow),
      providerNoise: providerNoise(timeline),
      cliReportedUsd: input.stream?.cliReportedUsd ?? null,
      modelUsage: Object.fromEntries(
        Object.entries(modelTotalsOf(input).totals).map(([model, reading]) => [model, reading.usage]),
      ),
      laneReport: report,
      quotaBefore: input.quotaBefore,
      quotaAfter: input.quotaAfter,
    },
  };
}
