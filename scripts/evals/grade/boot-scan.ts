/**
 * When did the run first boot, and when was it first playable (§8.3)? Answered over the run's
 * snapshots, cheaply: probing every snapshot would cost more than the run.
 *
 * - **Coarse:** every 4th snapshot and the last one, widened when that would spend more than half
 *   the probes, until the metric first passes; the last snapshot that failed brackets it.
 * - **Fine:** bisect the bracket.
 * - **Re-verify:** probe the answer again and its predecessor, because playability is not
 *   monotonic. An answer that does not pass again is left unanswered; a predecessor that passes
 *   moves the answer back one snapshot and is checked the same way.
 *
 * One quick probe answers both metrics, so the playable search reuses what the boot search saw.
 * A snapshot whose rebuild failed (or whose copy could not be served) is **unknown**, never
 * "did not boot": it is not probed in a browser, and it widens the resolution back to the last
 * snapshot that really failed. Each probe waits 20 s for a first draw (the final probe keeps its
 * 120 s). At most `maxProbes` probes; past `budgetMs` both answers are null with
 * `coverage: scan-budget`. A cap that stops a coarse pass before it found a pass leaves that
 * metric null with `coverage: scan-budget` too: that null is unmeasured, never "not reached". A cap
 * that only cuts the bisection or the re-verification keeps the best bracket it found.
 */
import { MINUTE_MS, SECOND_MS } from "../../../src/shared/duration.ts";
import type {
  BootScanOptions,
  BootScanResult,
  QuickProbeResult,
  RunQuickProbe,
  ServeHandle,
  ServeSnapshot,
} from "./types.ts";
import { CheckResult, Coverage, ProbeRow, ServedVia } from "../vocabulary.ts";

/** Probe every this-many snapshots on the coarse pass. */
export const SCAN_STRIDE = 4;
/** The most probes one run's scan may spend. */
export const SCAN_MAX_PROBES = 12;
/** The scan's wall-clock budget per run. */
export const SCAN_BUDGET_MS = 10 * MINUTE_MS;
/** How long a scan probe waits for a first draw. */
export const SCAN_FIRST_DRAW_TIMEOUT_MS = 20 * SECOND_MS;
/** The search method recorded in `BootScanResult.search`. */
const METHOD = "coarse-to-fine";

/** What a scan needs besides its options: the server and the quick probe (fakes in tests). */
export interface BootScanDeps {
  serve: ServeSnapshot;
  probe: RunQuickProbe;
}

/** The scan's result with its coverage and the first-boot resolution beside the playable one. */
export interface BootScanOutcome extends BootScanResult {
  /** The snapshot interval first boot resolved to (`resolutionMs` is first playable's). */
  firstBootResolutionMs: number | null;
  /** `full`; `scan-budget` past the budget or when the cap cut a coarse pass; `unmeasured` without snapshots. */
  coverage: Coverage;
}

/** One probe of one snapshot. */
interface Observed {
  servedVia: ServedVia;
  booted: CheckResult;
  playable: CheckResult;
}

/** Which metric a search is after. */
type Metric = (observed: Observed) => CheckResult;

const bootedOf: Metric = (observed) => observed.booted;
const playableOf: Metric = (observed) => observed.playable;

/** Why a scan stopped probing early. */
const Halt = {
  Cap: "cap",
  Budget: "budget",
} as const;
type Halt = (typeof Halt)[keyof typeof Halt];

/** One scan's running state. */
interface Scan {
  options: BootScanOptions;
  deps: BootScanDeps;
  now: () => number;
  startedAt: number;
  probes: number;
  /** The first observation of each snapshot, reused across both searches. */
  first: Map<number, Observed>;
  /** Every observation of each snapshot, re-verifications included. */
  all: Map<number, Observed[]>;
  probed: BootScanResult["probed"];
  halt: Halt | null;
}

/** A metric's answer: the snapshot index, or null; `cut` when the cap stopped its coarse pass early. */
interface Answer {
  index: number | null;
  cut: boolean;
}

/** Booted and playable from a quick probe: booted is `l1.builds_and_boots` (else the L1 gate). */
function fromProbe(result: QuickProbeResult, servedVia: ServedVia): Observed {
  const booted = result.rows[ProbeRow.L1BuildsAndBoots] ?? result.l1Gate;
  const playable = booted === CheckResult.Fail ? CheckResult.Fail : result.l2Gate;
  return { servedVia, booted, playable };
}

const UNKNOWN_REBUILD: Observed = {
  servedVia: ServedVia.RebuildFailed,
  booted: CheckResult.Unknown,
  playable: CheckResult.Unknown,
};

/** Whether the next probe may run; sets the halt reason when it may not. */
function mayProbe(scan: Scan): boolean {
  if (scan.halt !== null) return false;
  if (scan.probes >= scan.options.maxProbes) scan.halt = Halt.Cap;
  else if (scan.now() - scan.startedAt >= scan.options.budgetMs) scan.halt = Halt.Budget;
  return scan.halt === null;
}

/** Serve one snapshot and quick-probe it; a failed rebuild or serve is unknown and never probed. */
async function serveAndProbe(scan: Scan, index: number): Promise<Observed> {
  const snapshot = scan.options.snapshots[index];
  if (!snapshot) return UNKNOWN_REBUILD;
  let handle: ServeHandle | null = null;
  try {
    handle = await scan.deps.serve({ ...scan.options.serve, root: snapshot.dir });
    if (handle.servedVia === ServedVia.RebuildFailed) return UNKNOWN_REBUILD;
    const firstDrawTimeoutMs = Math.min(scan.options.probe.firstDrawTimeoutMs, SCAN_FIRST_DRAW_TIMEOUT_MS);
    const result = await scan.deps.probe(handle.url, { ...scan.options.probe, firstDrawTimeoutMs });
    return fromProbe(result, handle.servedVia);
  } catch {
    return { ...UNKNOWN_REBUILD, servedVia: handle?.servedVia ?? ServedVia.RebuildFailed };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Probe a snapshot afresh (a re-verification); null when the cap or budget stops it. */
async function observe(scan: Scan, index: number): Promise<Observed | null> {
  if (!mayProbe(scan)) return null;
  scan.probes += 1;
  const observed = await serveAndProbe(scan, index);
  const atMs = scan.options.snapshots[index]?.atMs ?? 0;
  scan.probed.push({ atMs, servedVia: observed.servedVia, booted: observed.booted, playable: observed.playable });
  scan.all.set(index, [...(scan.all.get(index) ?? []), observed]);
  if (!scan.first.has(index)) scan.first.set(index, observed);
  return observed;
}

/** A snapshot's first observation, probing it only when it has none. */
async function seen(scan: Scan, index: number): Promise<Observed | null> {
  return scan.first.get(index) ?? (await observe(scan, index));
}

/** The coarse pass's snapshot indices: every `stride`-th and the last, at most half the probes. */
export function coarseIndices(count: number, maxProbes: number): number[] {
  if (count === 0) return [];
  const points = Math.max(1, Math.ceil(maxProbes / 2));
  const stride = Math.max(SCAN_STRIDE, Math.ceil(count / points));
  const indices: number[] = [];
  for (let i = stride - 1; i < count; i += stride) indices.push(i);
  if (indices.at(-1) !== count - 1) indices.push(count - 1);
  return indices;
}

/** Walk the coarse points to the first pass; the bracket's low end is the last failure before it. */
async function coarse(scan: Scan, metric: Metric): Promise<{ lo: number; hi: number | null; cut: boolean }> {
  let lo = -1;
  for (const index of coarseIndices(scan.options.snapshots.length, scan.options.maxProbes)) {
    const observed = await seen(scan, index);
    if (observed === null) return { lo, hi: null, cut: true };
    const result = metric(observed);
    if (result === CheckResult.Pass) return { lo, hi: index, cut: false };
    if (result === CheckResult.Fail) lo = index;
  }
  return { lo, hi: null, cut: false };
}

/** Bisect (lo, hi] to the first pass; an unknown is not a pass and moves the low end. */
async function bisect(scan: Scan, metric: Metric, bracket: { lo: number; hi: number }): Promise<number> {
  let { lo, hi } = bracket;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const observed = await seen(scan, mid);
    if (observed === null) break;
    if (metric(observed) === CheckResult.Pass) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Re-verify the answer and walk back while its predecessor passes too; null when it does not pass again. */
async function reverify(scan: Scan, metric: Metric, found: number): Promise<number | null> {
  const again = await observe(scan, found);
  if (again === null) return found;
  if (metric(again) !== CheckResult.Pass) return null;
  let index = found;
  while (index > 0) {
    const before = await observe(scan, index - 1);
    if (before === null || metric(before) !== CheckResult.Pass) break;
    index -= 1;
  }
  return index;
}

/** One metric's search: coarse, fine, re-verified. */
async function search(scan: Scan, metric: Metric): Promise<Answer> {
  const { lo, hi, cut } = await coarse(scan, metric);
  if (hi === null) return { index: null, cut };
  const found = await bisect(scan, metric, { lo, hi });
  if (scan.halt !== null) return { index: found, cut: false };
  return { index: await reverify(scan, metric, found), cut: false };
}

/** The interval an answer resolved to: back to the last snapshot that really failed, or the prompt. */
function resolution(scan: Scan, metric: Metric, index: number): number {
  const at = (i: number) => scan.options.snapshots[i]?.atMs ?? 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const failed = (scan.all.get(i) ?? []).some((observed) => metric(observed) === CheckResult.Fail);
    if (failed) return at(index) - at(i);
  }
  return at(index);
}

/** A metric's time and resolution, or nulls. */
function timing(scan: Scan, metric: Metric, answer: Answer): { ms: number | null; resolutionMs: number | null } {
  if (answer.index === null) return { ms: null, resolutionMs: null };
  const ms = scan.options.snapshots[answer.index]?.atMs ?? null;
  return { ms, resolutionMs: resolution(scan, metric, answer.index) };
}

/** Whether the scan ran past its wall-clock budget. */
function overBudget(scan: Scan): boolean {
  return scan.halt === Halt.Budget || scan.now() - scan.startedAt > scan.options.budgetMs;
}

/** The scan's coverage: unmeasured without snapshots, scan-budget past the budget or when a search was cut. */
function coverageOf(scan: Scan, answers: readonly Answer[]): Coverage {
  if (scan.options.snapshots.length === 0) return Coverage.Unmeasured;
  const cut = answers.some((answer) => answer.cut);
  return overBudget(scan) || cut ? Coverage.ScanBudget : Coverage.Full;
}

/** A metric's timing when it was measured: nulls past the budget or when the cap cut its search. */
function measuredTiming(scan: Scan, metric: Metric, answer: Answer) {
  const measured = scan.options.snapshots.length > 0 && !overBudget(scan) && !answer.cut;
  return measured ? timing(scan, metric, answer) : { ms: null, resolutionMs: null };
}

/** The boot scan over injected serve and probe functions (`ScanBoot`, with coverage). */
export function createBootScan(deps: BootScanDeps): (options: BootScanOptions) => Promise<BootScanOutcome> {
  return async (options) => {
    const now = options.now ?? Date.now;
    const scan: Scan = {
      options,
      deps,
      now,
      startedAt: now(),
      probes: 0,
      first: new Map(),
      all: new Map(),
      probed: [],
      halt: null,
    };
    const boot = await search(scan, bootedOf);
    const playable = await search(scan, playableOf);
    const coverage = coverageOf(scan, [boot, playable]);
    const bootTiming = measuredTiming(scan, bootedOf, boot);
    const playTiming = measuredTiming(scan, playableOf, playable);
    return {
      firstBootMs: bootTiming.ms,
      firstPlayableMs: playTiming.ms,
      resolutionMs: playTiming.resolutionMs,
      firstBootResolutionMs: bootTiming.resolutionMs,
      search: { method: METHOD, probes: scan.probes, capped: scan.halt !== null },
      probed: scan.probed,
      coverage,
    };
  };
}
