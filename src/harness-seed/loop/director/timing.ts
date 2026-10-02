/** Local orchestration timings measure real calls, not translated provider tool messages. */
export interface OperationSpan {
  operation: string;
  goal: string | null;
  startedAt: number;
  durationMs: number;
  settled: boolean;
  clockOrigin?: number;
  monotonicStart?: number;
  monotonicEnd?: number;
  runId?: string;
  worker?: string | null;
  role?: string | null;
  model?: string | null;
  effort?: string | null;
  head?: string | null;
  usage?: Record<string, number>;
}
export interface TimingClock {
  origin?: number;
  wall(): number;
  monotonic(): number;
}
const CLOCK: TimingClock = { wall: Date.now, monotonic: () => performance.now(), origin: performance.timeOrigin };

/** Monotonic duration survives wall-clock adjustments; an exception is never recorded as settled. */
export async function timedOperation<T>(
  operation: string,
  goal: string | null,
  action: () => Promise<T>,
  record: (span: OperationSpan) => void,
  clock: TimingClock = CLOCK,
): Promise<T> {
  const startedAt = clock.wall();
  const started = clock.monotonic();
  let settled = false;
  try {
    const result = await action();
    settled = true;
    return result;
  } finally {
    const ended = clock.monotonic();
    record({
      operation,
      goal,
      startedAt,
      ...(clock.origin === undefined ? {} : { clockOrigin: clock.origin }),
      durationMs: Math.max(0, ended - started),
      settled,
      monotonicStart: started,
      monotonicEnd: ended,
    });
  }
}

/** Wall-time union and aggregate work differ when operations overlap; never sum one as the other. */
export function elapsedOperations(spans: readonly OperationSpan[]): { workMs: number; wallMs: number } {
  const intervals = spans
    .map((span) => {
      const start =
        span.clockOrigin !== undefined && span.monotonicStart !== undefined
          ? span.clockOrigin + span.monotonicStart
          : span.startedAt;
      return [start, start + span.durationMs] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  let wallMs = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [start, stop] of intervals) {
    wallMs += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return { workMs: spans.reduce((total, span) => total + span.durationMs, 0), wallMs };
}

/** Bounded local history keeps timing evidence from growing every future prompt or journal indefinitely. */
export const MAX_OPERATION_SPANS = 2_048;

/** Append measurements without prompts, arguments, credentials, or repeated provider context snapshots. */
export function retainSpan(
  record: { operationSpans?: OperationSpan[]; omittedSpans?: number },
  span: OperationSpan,
): void {
  record.operationSpans ??= [];
  record.operationSpans.push(span);
  if (record.operationSpans.length > MAX_OPERATION_SPANS) {
    record.operationSpans.shift();
    record.omittedSpans = (record.omittedSpans ?? 0) + 1;
  }
}
