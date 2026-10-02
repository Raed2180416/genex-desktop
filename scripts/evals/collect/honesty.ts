/**
 * The collectors' honesty gates (Rule 3): how the receive-stamped stream is read, whether the
 * trace was read whole (`traceComplete`), and how much provider noise it showed (`providerNoise`),
 * from typed fields only. A dirty trace makes judgement metrics unknown and timing metrics
 * contaminated; `metrics.ts` reads `isTraceClean`. Every parser also asserts that it measured
 * something, and throws a `CollectError` naming the code when it did not.
 */
import { EndedHow } from "../../../src/shared/eval-lane.ts";
import type { ProviderNoise, TraceCompleteness } from "../ledger/types.ts";
import type { ObservationEvent } from "./observation.ts";
import { ObservationEventKind, ObservedErrorKind } from "../vocabulary.ts";

/** Why a collector refused its input: a bug upstream or a vacuous read, never a silent zero. */
export const CollectErrorCode = {
  /** A stream line carries no receive timestamp (Rule 12): the lane runner's bug. */
  MissingReceiveStamp: "missing-receive-stamp",
  /** A non-empty source yielded no model call (Rule 3). */
  VacuousModelCalls: "vacuous-model-calls",
} as const;
export type CollectErrorCode = (typeof CollectErrorCode)[keyof typeof CollectErrorCode];

/** A collector's refusal, with its code and where it happened. */
export class CollectError extends Error {
  readonly code: CollectErrorCode;
  constructor(code: CollectErrorCode, where: string) {
    super(`${code}: ${where}`);
    this.name = "CollectError";
    this.code = code;
  }
}

/** One stream event and when the lane runner received it (epoch milliseconds). */
export interface StampedLine {
  receivedAtMs: number;
  /** 1-based line number in the stream file. */
  line: number;
  event: Record<string, unknown>;
}

/** A stream read: its events, the lines that did not parse, and whether the last line was cut mid-write. */
export interface StampedStream {
  lines: StampedLine[];
  parseFailures: number;
  partialTail: boolean;
}

/** What one source says about its own completeness, before the run's ending is known. */
export interface TraceReading {
  parseFailures: number;
  /** The file's last line was cut mid-write. */
  partialTail: boolean;
  /** The source's own terminal record (`result`, `turn.completed`/`turn.failed`) was seen. */
  sawTerminal: boolean;
}

/** The endings after which a CLI writes its terminal record; any other ending is our rail and cuts the stream. */
const ENDINGS_WITH_TERMINAL: ReadonlySet<EndedHow> = new Set([EndedHow.AgentFinished, EndedHow.MaxTurns]);

/** A JSON value as an object, or null: the collectors read fields only through these typed readers. */
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A finite number field, or null. */
export const numberField = (record: Record<string, unknown> | null | undefined, key: string): number | null => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** A string field, or null. */
export const stringField = (record: Record<string, unknown> | null | undefined, key: string): string | null => {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
};

/** An object field, or null. */
export const recordField = (record: Record<string, unknown> | null | undefined, key: string) => asRecord(record?.[key]);

/** An array field, or an empty array. */
export const arrayField = (record: Record<string, unknown> | null | undefined, key: string): unknown[] => {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
};

/** A JSON line as an object, or null for a line that is not one. */
export function parseObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Epoch milliseconds from a number or an ISO instant, or null. */
export function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A `{receivedAt, line}` record whose inner line is not JSON: a parse failure even on the last line. */
const INNER_NOT_JSON = "inner-not-json";

/**
 * Whether a stored line is the lane runner's `{receivedAt, line}` record (`lanes/common.ts`
 * `StreamRecord`) rather than an event with `receivedAt` added: exactly those two keys, the line
 * a string. A CLI event always carries its own `type`, so it never takes this shape.
 */
function isStreamRecord(outer: Record<string, unknown>): outer is { receivedAt: unknown; line: string } {
  const keys = Object.keys(outer);
  return keys.length === 2 && "receivedAt" in outer && typeof outer.line === "string";
}

/**
 * One stored stream line as its event and receive time. Two shapes are accepted, both stamped by
 * `receivedAt` (epoch ms or ISO): the lane runner's `{receivedAt, line: "<raw json>"}` record, or
 * the event itself with a `receivedAt` field added. Returns null for a line that is not JSON;
 * throws for JSON without a receive stamp.
 */
function stampedEvent(text: string, line: number): StampedLine | null | typeof INNER_NOT_JSON {
  const outer = parseObject(text);
  if (!outer) return null;
  const receivedAtMs = epochMs(outer.receivedAt);
  if (receivedAtMs === null) throw new CollectError(CollectErrorCode.MissingReceiveStamp, `line ${line}`);
  if (isStreamRecord(outer)) {
    const event = parseObject(outer.line);
    return event ? { receivedAtMs, line, event } : INNER_NOT_JSON;
  }
  const { receivedAt: _stamp, ...event } = outer;
  return { receivedAtMs, line, event };
}

/** Read a receive-stamped stream (Rule 12). A torn final line is `partialTail`; any other unreadable line is a parse failure. */
export function parseStampedStream(text: string): StampedStream {
  const rows = text.split("\n");
  const endsClean = text.length === 0 || text.endsWith("\n");
  const out: StampedStream = { lines: [], parseFailures: 0, partialTail: false };
  rows.forEach((row, index) => {
    if (!row.trim()) return;
    const read = stampedEvent(row, index + 1);
    if (read !== null && read !== INNER_NOT_JSON) {
      out.lines.push(read);
      return;
    }
    const isLast = index === rows.length - 1;
    if (isLast && !endsClean && read === null) out.partialTail = true;
    else out.parseFailures += 1;
  });
  return out;
}

/**
 * Whether the trace was read whole. A source is truncated when its last line was torn, or when it
 * lacks its terminal record although the run ended in a way that writes one (a rail stop does not).
 */
export function traceComplete(readings: readonly TraceReading[], endedHow: EndedHow): TraceCompleteness {
  const expectsTerminal = ENDINGS_WITH_TERMINAL.has(endedHow);
  let parseFailures = 0;
  let truncatedTail = false;
  for (const reading of readings) {
    parseFailures += reading.parseFailures;
    const missingTerminal = expectsTerminal && !reading.sawTerminal;
    if (reading.partialTail || missingTerminal) truncatedTail = true;
  }
  return { parseFailures, truncatedTail };
}

/** A trace with no parse failure and no truncated tail. */
export function isTraceClean(trace: TraceCompleteness): boolean {
  return trace.parseFailures === 0 && !trace.truncatedTail;
}

const API_ERRORS: ReadonlySet<ObservedErrorKind> = new Set([
  ObservedErrorKind.ApiError,
  ObservedErrorKind.RateLimited,
  ObservedErrorKind.AuthExpired,
]);

/** Provider noise from the timeline's typed error and retry events only; never from message text. */
export function providerNoise(timeline: readonly ObservationEvent[]): ProviderNoise {
  const noise: ProviderNoise = { apiErrors: 0, retries: 0, apiErrorStatus: null };
  for (const event of timeline) {
    if (event.kind === ObservationEventKind.Retry) noise.retries += 1;
    if (event.kind !== ObservationEventKind.Error || !API_ERRORS.has(event.error)) continue;
    noise.apiErrors += 1;
    if (event.httpStatus !== null) noise.apiErrorStatus = event.httpStatus;
  }
  return noise;
}
