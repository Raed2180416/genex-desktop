/** The system settings the renderer's motion and art follow, each spelled once as a media query. */

/** Reduce Motion is on. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** The system appearance is dark. */
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** Is Reduce Motion on right now? */
export const prefersReducedMotion = (): boolean => matchMedia(REDUCED_MOTION_QUERY).matches;
