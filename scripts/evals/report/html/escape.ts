/**
 * Escaping for the static ledger explorer. Every value the page prints passes through
 * `escapeHtml` (text and attribute values alike), and the embedded data block goes through
 * `jsonForScript`, which leaves no `<`, `>` or `&` that could close the script element or open a
 * comment, and no line separator that an old parser would read as a newline.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escape text for HTML element content or a quoted attribute value. */
export function escapeHtml(value: string | number | boolean | null): string {
  return String(value).replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char] ?? char);
}

const SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** JSON safe to place inside `<script type="application/json">`: `JSON.parse` of its text returns the value. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => SCRIPT_ESCAPES[char] ?? char);
}
