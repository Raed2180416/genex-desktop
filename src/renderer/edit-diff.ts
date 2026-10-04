/**
 * The diff an exact edit shows: the changed lines in file order, with a little unchanged text
 * around each change so a reader sees where it lands, and a gap mark for what is left out.
 */

/** What a diff line is: an addition, a deletion, unchanged context, or unchanged lines left out. */
export const DiffTone = {
  Add: "add",
  Del: "del",
  Ctx: "ctx",
  Gap: "gap",
} as const;
export type DiffTone = (typeof DiffTone)[keyof typeof DiffTone];

/** One line of a diff as the review draws it; a gap's text is empty. */
export interface DiffLine {
  text: string;
  tone: DiffTone;
}

/** Unchanged lines kept on each side of a change. */
const CONTEXT_LINES = 2;
/** Above this many line pairs the alignment table is too large; the middle shows as removed, then added. */
const MAX_ALIGNED_CELLS = 4_000_000;

const line =
  (tone: DiffTone) =>
  (text: string): DiffLine => ({ text, tone });
const ctx = line(DiffTone.Ctx);
const add = line(DiffTone.Add);
const del = line(DiffTone.Del);
const GAP: DiffLine = { text: "", tone: DiffTone.Gap };

/** The edit from `before` to `after`, aligned line by line, with context around each change. */
export function editDiff(before: string, after: string, context = CONTEXT_LINES): DiffLine[] {
  if (before === after) return [];
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  return withContext(alignedLines(a, b), context);
}

/** Every line of both texts in file order: the shared head and tail, and the aligned middle. */
function alignedLines(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [
    ...a.slice(0, start).map(ctx),
    ...alignedMiddle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(ctx),
  ];
}

/** The longest common run of lines kept as context; everything else removed or added where it stands. */
function alignedMiddle(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_ALIGNED_CELLS) return [...a.map(del), ...b.map(add)];
  const width = b.length + 1;
  const common = commonFromEnd(a, b);
  const at = (i: number, j: number) => common[i * width + j] ?? 0;
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] ?? "";
    const right = b[j] ?? "";
    if (left === right) {
      out.push(ctx(left));
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push(del(left));
      i++;
    } else {
      out.push(add(right));
      j++;
    }
  }
  return [...out, ...a.slice(i).map(del), ...b.slice(j).map(add)];
}

/** For every pair of positions, how many lines the rest of `a` and `b` have in common. */
function commonFromEnd(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const next = a[i] === b[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : 0;
      table[i * width + j] = Math.max(next, table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  return table;
}

/** The changed lines and `context` lines around each; every run left out becomes one gap. */
function withContext(lines: DiffLine[], context: number): DiffLine[] {
  const changed = lines.map((entry) => entry.tone !== DiffTone.Ctx);
  const nearChange = (index: number) => changed.slice(Math.max(0, index - context), index + context + 1).some(Boolean);
  const out: DiffLine[] = [];
  lines.forEach((entry, index) => {
    if (nearChange(index)) out.push(entry);
    else if (out.at(-1) !== GAP) out.push(GAP);
  });
  return out;
}

/** Where a hunk header says the hunk starts, in the old and the new file. */
const HUNK_START = /^@@ -(\d+)(?:,\d+)? \+(\d+)/;

/**
 * A git patch as the exact edit reads it: its hunks' lines, the file headers git writes above
 * them left out, a gap for each hunk that does not start at the top, at most `limit` lines.
 */
export function patchDiff(patch: string, limit = Number.POSITIVE_INFINITY): DiffLine[] {
  const out: DiffLine[] = [];
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    if (out.length >= limit) break;
    const read = readPatchLine(raw, inHunk);
    inHunk = read.inHunk;
    if (read.line) out.push(read.line);
  }
  return out;
}

/** One patch line read in place: whether it opens or leaves a hunk, and the diff line it shows. */
function readPatchLine(raw: string, inHunk: boolean): { inHunk: boolean; line: DiffLine | null } {
  const hunk = HUNK_START.exec(raw);
  if (hunk) return { inHunk: true, line: Number(hunk[1]) > 1 || Number(hunk[2]) > 1 ? GAP : null };
  if (raw.startsWith("diff --git ")) return { inHunk: false, line: null };
  return { inHunk, line: inHunk ? patchLine(raw) : null };
}

/** One line inside a hunk; git's "No newline at end of file" note is not part of the file. */
function patchLine(raw: string): DiffLine | null {
  if (raw.startsWith("\\")) return null;
  if (raw.startsWith("+")) return add(raw.slice(1));
  if (raw.startsWith("-")) return del(raw.slice(1));
  return ctx(raw.slice(1));
}
