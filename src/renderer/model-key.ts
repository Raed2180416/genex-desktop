/**
 * A composer model key, `engine::model`: the one string the model picker, the stored picks and
 * a send share. Stored in local storage: never change the separator.
 */

/** What joins an engine id and a model id in a model key. */
export const MODEL_KEY_SEPARATOR = "::";

/** The key for a model of an engine. */
export const modelKey = (engine: string, model: string): string => `${engine}${MODEL_KEY_SEPARATOR}${model}`;

/** A key's two halves; a missing half (or a missing key) reads as "". */
export function parseModelKey(key: string | null | undefined): { engine: string; model: string } {
  const [engine = "", model = ""] = (key ?? "").split(MODEL_KEY_SEPARATOR);
  return { engine, model };
}
