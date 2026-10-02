/**
 * The theme's motion tokens for motion run from script (theme.css `--duration-fast`,
 * `--duration-quick` and `--ease-smooth-out`): one opening, one closing and one ease for everything
 * in the chat that comes, goes or resizes.
 */

/** How long an opening or a resize takes (`--duration-fast`). */
export const OPEN_MS = 250;
/** How long a closing takes (`--duration-quick`). */
export const CLOSE_MS = 150;
/** The shared ease (`--ease-smooth-out`). */
export const SMOOTH_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

/** The glide from the size shown to a new one, or null to take it at once: the first size, or one already shown. */
export function sizeGlide(shown: number | null, size: number): { from: number; to: number } | null {
  if (shown === null || Math.abs(shown - size) < 0.5) return null;
  return { from: shown, to: size };
}
