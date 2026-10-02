/**
 * Why a boot probe saw what it saw: diagnostic categories, not quality verdicts. An entry script
 * that was never requested is not a JavaScript error, and an entry that loaded without a draw is a
 * different story from one that answered 404.
 */

/** What the boot observation shows, in one code. */
export const BootObservation = {
  DrawObserved: "draw-observed",
  EntryNotRequested: "entry-not-requested",
  EntryHttpFailed: "entry-http-failed",
  EntryLoadedNoDraw: "entry-loaded-no-draw",
  Unknown: "unknown",
} as const;
export type BootObservation = (typeof BootObservation)[keyof typeof BootObservation];

/** The facts `classifyBootObservation` reads. */
export interface BootObservationInput {
  entryRequested: boolean;
  entryStatus: number | null;
  canvasCount: number;
  animationFrames: number;
  nonDegenerateDraw: boolean;
}

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const HTTP_ERROR_MIN = 400;

/** Classify one boot observation; an unobserved entry is `unknown`, never a failure. */
export function classifyBootObservation(input: BootObservationInput): BootObservation {
  if (input.canvasCount > 0 && input.nonDegenerateDraw) return BootObservation.DrawObserved;
  if (!input.entryRequested) return BootObservation.EntryNotRequested;
  const status = input.entryStatus;
  if (status === null) return BootObservation.Unknown;
  if (status >= HTTP_ERROR_MIN) return BootObservation.EntryHttpFailed;
  if (status >= HTTP_OK_MIN && status < HTTP_OK_MAX) return BootObservation.EntryLoadedNoDraw;
  return BootObservation.Unknown;
}

/** A URL safe to persist: queries and fragments can carry credentials, so only origin and path are kept. */
export function diagnosticUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin + u.pathname : u.protocol;
  } catch {
    return "<invalid-url>";
  }
}
