/**
 * index.html's head runs this before the page is first drawn: the saved appearance, or on a first
 * launch the system's light or dark, is on the root before anything paints, so the window never
 * opens in the wrong theme. The store (`store.ts`) takes over when the app's bundle runs.
 */
import { DARK_SCHEME_QUERY } from "../ui/media-queries.ts";
import { paintAppearance, savedAppearance } from "./paint.ts";
import { resolveScheme } from "./themes.ts";

const { appearance } = savedAppearance();
paintAppearance(
  document.documentElement,
  appearance,
  resolveScheme(appearance.mode, matchMedia(DARK_SCHEME_QUERY).matches),
);
