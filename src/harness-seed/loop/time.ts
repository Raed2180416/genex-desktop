/**
 * Time, in the units a person reads: `30 * SECOND_MS`, not `30000`. The app keeps the same units
 * in `shared/duration.ts` (tests/conformance/seed-contracts.test.ts holds the two together).
 */

/** One second in milliseconds. */
export const SECOND_MS = 1000;
/** One minute in milliseconds. */
export const MINUTE_MS = 60 * SECOND_MS;
/** One hour in milliseconds. */
export const HOUR_MS = 60 * MINUTE_MS;

/** How often a cancellable wait looks at `ctx.cancelled`. */
export const CANCEL_POLL_MS = 250;

/** Wait `ms`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait `ms`, or less when the run is cancelled first (checked every `CANCEL_POLL_MS`). */
export async function sleepUnlessCancelled(ctx: { cancelled?: boolean } | null | undefined, ms: number): Promise<void> {
  const wake = Date.now() + ms;
  while (Date.now() < wake && !ctx?.cancelled) await sleep(Math.min(CANCEL_POLL_MS, wake - Date.now()));
}

/** A span as whole minutes for a sentence: rounded, and never below zero. */
export function minutes(ms: number): number {
  return Math.max(0, Math.round(ms / MINUTE_MS));
}
