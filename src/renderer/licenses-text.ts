/**
 * The shipped notices are hard-wrapped Markdown, and the app's Markdown keeps every line break,
 * so Settings → Licenses joins the wrapped lines of each paragraph and list item first.
 */

/** A fence opening or closing a code block, whose lines stay exactly as written. */
const FENCE = /^\s*(```|~~~)/;
/** A line that starts its own block: blank, a heading, list item, quote, table row or code. */
const BLOCK_START = /^(\s*$|\s*#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*\||\s{4})/;

/** Whether the line above can take the next line's words: prose, not a heading, table or fence. */
function continues(previous: string | undefined): previous is string {
  if (previous === undefined || previous.trim() === "") return false;
  return !/^\s*(#{1,6}\s|\||```|~~~)/.test(previous);
}

/** Markdown with each paragraph and list item on one line; fenced code and block starts untouched. */
export function unwrapMarkdown(markdown: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    const fence = FENCE.test(line);
    const previous = lines.at(-1);
    if (!fenced && !fence && !BLOCK_START.test(line) && continues(previous)) {
      lines[lines.length - 1] = `${previous} ${line.trim()}`;
      continue;
    }
    if (fence) fenced = !fenced;
    lines.push(line);
  }
  return lines.join("\n");
}
