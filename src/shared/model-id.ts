/**
 * The one comparison of a served model id across sources. Claude Code tags the id it reports for
 * a model's totals with its context window (`claude-opus-5-5[1m]`), while a transcript or stream
 * call names the API id (`claude-opus-5-5`); the app's run facts and the eval collector both match
 * the two through this normaliser, so a model's tokens are never counted under two ids.
 */

/** Claude Code's trailing context-size tag on a model id (`[1m]`). */
const CONTEXT_TAG = /\[[^\]]*\]$/;

/** A model id as compared across sources: trimmed, lowercased and without its context-size tag. */
export const untaggedModelId = (model: string): string => model.trim().toLowerCase().replace(CONTEXT_TAG, "");
