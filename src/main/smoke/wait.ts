/**
 * Waiting, for the smoke, self test and acceptance runners: one sleep and one poll, so a runner
 * never hand-rolls a `Date.now()` loop or wraps `setTimeout` in a promise of its own.
 */
import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

export interface WaitOptions {
  /** How long to keep asking before answering false. */
  timeoutMs: number;
  /** The pause between two questions. */
  intervalMs: number;
}

/**
 * Ask `probe` until it answers truthy (then true) or `timeoutMs` has passed (then false). The
 * probe is asked first and again after each interval, and a probe that is still pending when the
 * deadline passes gets its answer counted. A throwing probe rejects the wait: a caller that
 * tolerates a failing probe says so in the probe (`.catch(() => false)`).
 */
export async function waitFor(probe: () => unknown, { timeoutMs, intervalMs }: WaitOptions): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await probe()) return true;
    await sleep(intervalMs);
  }
  return false;
}
