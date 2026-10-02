/**
 * Reading what a director's tool call carries. The bridges hand every argument over as a string
 * (Codex as a shell command line), so a number, a yes/no, a list or a JSON value is parsed here,
 * forgivingly, and a malformed one comes back as something the caller can answer in words.
 */
import { clip, CLIP_QUOTE } from "../text.ts";

/** The longest id a worker, a part or a target may have. */
const MAX_SLUG = 40;
/** How much of a kind that is not one a refusal or a note quotes. */
export const KIND_QUOTED = 40;

/** A value as an id: lower case, letters, digits, dashes and underscores, at most forty characters. */
export const slug = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG);

/** A comma-separated field as its trimmed, non-empty entries. */
export const list = (value: unknown): string[] =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** A field as a number, or `fallback` when it is empty or not one. */
export const num = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) && String(value).trim() !== "" ? Number(value) : fallback;

/** Was nothing given at all (absent, null or blank)? */
const isBlank = (value: unknown): boolean => value === undefined || value === null || String(value).trim() === "";

/** A yes/no field (`y`, `yes`, `true`, `1` are yes), or `fallback` when it is empty. */
export const yes = (value: unknown, fallback: boolean): boolean =>
  isBlank(value) ? fallback : /^(y|yes|true|1)$/i.test(String(value).trim());

/** A value as it is written into a record: the same data with every `base64` frame taken out. */
export const withoutFrames = (value: unknown): any =>
  JSON.parse(JSON.stringify(value, (key, v) => (key === "base64" ? undefined : v)));

/**
 * A field that may carry JSON: null when it is empty, the value itself when it already is one,
 * and `{ __error }` — the sentence to answer with — when it does not parse.
 */
export const parseJson = (text: unknown): any => {
  if (isBlank(text)) return null;
  if (typeof text === "object") return text;
  try {
    return JSON.parse(String(text));
  } catch {
    return { __error: `not JSON: ${clip(text, CLIP_QUOTE)}` };
  }
};

/** A field that may arrive as a JSON array or as free lines — the bridge carries only strings. */
export const lines = (value: unknown): string[] => {
  const parsed = parseJson(value);
  const raw: unknown[] = Array.isArray(parsed) ? parsed : String(value ?? "").split(/\n|;/);
  return raw.map((entry) => String(entry ?? "").trim()).filter(Boolean);
};

/**
 * A worker's title only when somebody wrote one: `title` falls back to the id, and an id is a
 * slug no vocabulary can translate, so a verdict would read "what w2 built" on the user's screen.
 */
export const namedTitle = (worker: { id?: string; title?: string } | null | undefined): string | null =>
  worker?.title && worker.title !== worker.id ? worker.title : null;
