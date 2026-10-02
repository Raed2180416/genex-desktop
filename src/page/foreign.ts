/**
 * The page world's types. Everything the studio's page code touches belongs to somebody else's
 * game — its renderer, its scene, its canvas context, the globals it set — so it is read
 * defensively, field by field, and never trusted to have a shape. Type-only: nothing here is
 * bundled onto the page.
 */

/** A value that belongs to the game's page (a three.js object, a GL context, a game global). */
// biome-ignore lint/suspicious/noExplicitAny: the game's own objects, read defensively at each use
export type Foreign = any;

/** The page's global object, with whatever the game and the studio have put on it. */
export type PageGlobal = typeof globalThis & Record<string, Foreign>;
