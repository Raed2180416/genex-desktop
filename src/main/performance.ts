import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { PerformanceMarkName, type PerformanceMark } from "../shared/performance.ts";
import { MINUTE_MS } from "../shared/duration.ts";

const CHANNEL_CAP = 256;
const PENDING_JOURNEY_CAP = 64;
const JOURNEY_PAIRS = [
  [PerformanceMarkName.EventBatch, PerformanceMarkName.GraphCommit],
  [PerformanceMarkName.Delta, PerformanceMarkName.TextPaint],
  [PerformanceMarkName.Keydown, PerformanceMarkName.ComposerCommit],
] as const;
const BUCKETS_MS = [1, 4, 16, 50, 100, 500, Number.POSITIVE_INFINITY];
const LOOP_RESOLUTION_MS = 10;
const LOOP_WARN_MS = 50;
const NS_PER_MS = 1_000_000;
interface Histogram {
  count: number;
  bytes: number;
  maxMs: number;
  buckets: number[];
}

/** Bounded diagnostics with injectable time; disabled launches do no accounting or serialization. */
export class PerformanceRecorder {
  readonly #enabled: boolean;
  readonly #now: () => number;
  readonly #start: number;
  readonly #channels = new Map<string, Histogram>();
  readonly #marks = new Map<string, number>();
  readonly #journeys = new Map<PerformanceMarkName, number[]>();
  constructor(enabled: boolean, now: () => number = () => performance.now()) {
    this.#enabled = enabled;
    this.#now = now;
    this.#start = now();
  }
  /** Monotonic time for an instrumented handler. */
  now(): number {
    return this.#enabled ? this.#now() : 0;
  }
  /** Retain the first occurrence of a startup or journey mark. */
  mark(name: string): void {
    if (this.#enabled && !this.#marks.has(name) && this.#marks.size < CHANNEL_CAP)
      this.#marks.set(name, this.#now() - this.#start);
  }
  /** Pair content-free renderer timestamps on their own clock; keep startup marks on main receipt time. */
  rendererMark(sample: PerformanceMark): void {
    if (!this.#enabled || !Number.isFinite(sample.at) || sample.at < 0) return;
    this.mark(`renderer:${sample.name}`);
    this.record(`journey:${sample.name}`);
    for (const [start, end] of JOURNEY_PAIRS) {
      if (sample.name === start) this.#startJourney(start, sample.at);
      if (sample.name === end) this.#endJourney(start, end, sample.at);
    }
  }

  #startJourney(start: PerformanceMarkName, at: number): void {
    let pending = this.#journeys.get(start) ?? [];
    const previous = pending.at(-1);
    // A renderer reload resets its clock; samples from the old page cannot pair with the new page.
    if (previous !== undefined && at < previous) pending = [];
    pending.push(at);
    if (pending.length > PENDING_JOURNEY_CAP) pending.shift();
    this.#journeys.set(start, pending);
  }

  #endJourney(start: PerformanceMarkName, end: PerformanceMarkName, at: number): void {
    const pending = this.#journeys.get(start);
    if (!pending) return;
    const future: number[] = [];
    for (const began of pending) {
      if (began > at) future.push(began);
      else this.record(`journey:${start}->${end}`, at - began);
    }
    if (future.length) this.#journeys.set(start, future);
    else this.#journeys.delete(start);
  }

  /** Add one invoke or push to its fixed-size histogram. */
  record(channel: string, durationMs = 0, bytes = 0): void {
    if (!this.#enabled) return;
    let entry = this.#channels.get(channel);
    if (!entry) {
      if (this.#channels.size >= CHANNEL_CAP) return;
      entry = { count: 0, bytes: 0, maxMs: 0, buckets: BUCKETS_MS.map(() => 0) };
      this.#channels.set(channel, entry);
    }
    entry.count++;
    entry.bytes += bytes;
    entry.maxMs = Math.max(entry.maxMs, durationMs);
    const bucket = BUCKETS_MS.findIndex((ceiling) => durationMs <= ceiling);
    entry.buckets[Math.max(0, bucket)]++;
  }
  /** Serialize push bytes only when instrumentation is enabled. */
  push(type: string, payload: unknown): void {
    if (this.#enabled) this.record(`push:${type}`, 0, Buffer.byteLength(JSON.stringify(payload)));
  }
  /** Return copies so readers cannot mutate subsequent observations. */
  snapshot() {
    return {
      enabled: this.#enabled,
      // The clock counts from process start, so its first reading is how long Electron took to
      // reach main's own code: loading and evaluating the bundle and what it imports at the top.
      ...(this.#enabled ? { loadedAfterMs: this.#start } : {}),
      marks: Object.fromEntries(this.#marks),
      channels: Object.fromEntries(
        [...this.#channels].map(([key, value]) => [key, { ...value, buckets: [...value.buckets] }]),
      ),
    };
  }
}

/** Event-loop delay and utilization, installed only by an opted-in launch. */
export function watchEventLoop(write: (value: unknown) => void) {
  const delay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  let previous = performance.eventLoopUtilization();
  let latest = { p99Ms: 0, maxMs: 0, utilization: 0 };
  delay.enable();
  const timer = setInterval(() => {
    const current = performance.eventLoopUtilization();
    latest = {
      p99Ms: delay.percentile(99) / NS_PER_MS,
      maxMs: delay.max / NS_PER_MS,
      utilization: performance.eventLoopUtilization(current, previous).utilization,
    };
    previous = current;
    if (latest.maxMs >= LOOP_WARN_MS) write(latest);
    delay.reset();
  }, MINUTE_MS);
  timer.unref();
  return {
    snapshot: () => latest,
    stop: () => {
      clearInterval(timer);
      delay.disable();
    },
  };
}
