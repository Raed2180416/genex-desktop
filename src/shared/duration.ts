/**
 * Time units in milliseconds, so a timeout reads as what it is: `30 * SECOND_MS`, not `30000`.
 * Browser-safe; main, the substrate and the renderer share it. The harness seed keeps its own
 * copy in `loop/time.ts`.
 */

/** One second in milliseconds. */
export const SECOND_MS = 1000;
/** One minute in milliseconds. */
export const MINUTE_MS = 60 * SECOND_MS;
/** One hour in milliseconds. */
export const HOUR_MS = 60 * MINUTE_MS;
/** One day in milliseconds. */
export const DAY_MS = 24 * HOUR_MS;
