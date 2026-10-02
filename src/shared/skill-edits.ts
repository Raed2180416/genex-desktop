/**
 * The four bounded edits SkillOpt may make to a skill file (append, insert_after, replace,
 * delete), as the host replays them. The harness proposes a learned change as these edits plus
 * the whole file they leave; when the file has changed since, the host replays the same edits on
 * today's text (`main/self-changes.ts`) and refuses the change unless every one still applies.
 *
 * String-anchored rather than line-numbered, so an edit either matches or is rejected — it can
 * never land in the wrong place after the file has drifted. Text between two
 * `<!-- SLOW_UPDATE -->` markers (or after a lone one) is protected.
 *
 * The harness applies the same edits with its own copy (`src/harness-seed/loop/skills.ts`),
 * which the app must not load; `tests/conformance/seed-contracts.test.ts` runs one table of
 * edits through both, because a replay that disagreed with the proposal would refuse every
 * rebase.
 */
export const SKILL_EDIT_OPS = ["append", "insert_after", "replace", "delete"] as const;
export type SkillEditOp = (typeof SKILL_EDIT_OPS)[number];

/** One edit as the harness wrote it. Fields are unchecked: the harness is agent-edited code. */
export interface SkillEdit {
  op?: unknown;
  anchor?: unknown;
  text?: unknown;
}

export interface SkillEditResult {
  text: string;
  applied: SkillEdit[];
  rejected: Array<{ edit: SkillEdit; reason: string }>;
}

const PROTECTED_MARKER = "<!-- SLOW_UPDATE -->";

type Span = { start: number; end: number } | null;
type Outcome = { ok: true; text: string } | { ok: false; reason: string };

/** Apply the edits in order; each one either lands whole or is rejected with a reason. */
export function applyEdits(text: string, edits: readonly unknown[]): SkillEditResult {
  let out = text;
  const applied: SkillEdit[] = [];
  const rejected: SkillEditResult["rejected"] = [];
  for (const value of edits) {
    // Not an edit at all: nothing to apply, and nothing to say but that its op is unknown.
    const edit: SkillEdit = value && typeof value === "object" ? (value as SkillEdit) : {};
    const result = applyOne(out, edit, protectedSpan(out));
    if (result.ok) {
      out = result.text;
      applied.push(edit);
    } else {
      rejected.push({ edit, reason: result.reason });
    }
  }
  return { text: out, applied, rejected };
}

function protectedSpan(text: string): Span {
  const start = text.indexOf(PROTECTED_MARKER);
  if (start < 0) return null;
  const end = text.indexOf(PROTECTED_MARKER, start + PROTECTED_MARKER.length);
  return end < 0 ? { start, end: text.length } : { start, end: end + PROTECTED_MARKER.length };
}

function overlapsProtected(index: number, length: number, span: Span): boolean {
  if (!span || index < 0) return false;
  return index < span.end && index + length > span.start;
}

/** The edits that find their place by an anchor string. */
const ANCHORED_OPS: ReadonlySet<unknown> = new Set<SkillEditOp>(["insert_after", "replace", "delete"]);

function appendEdit(text: string, edit: SkillEdit): Outcome {
  if (!edit.text) return { ok: false, reason: "append needs text" };
  return { ok: true, text: `${text.replace(/\s*$/, "")}\n${edit.text}\n` };
}

function insertAfter(text: string, anchor: string, edit: SkillEdit, span: Span): Outcome {
  const index = text.indexOf(anchor);
  if (index < 0) return { ok: false, reason: `anchor not found: ${anchor}` };
  const at = index + anchor.length;
  if (overlapsProtected(at, 0, span)) return { ok: false, reason: "anchor is inside a protected region" };
  return { ok: true, text: `${text.slice(0, at)}\n${edit.text}${text.slice(at)}` };
}

/** Replaces the anchor with `replacement` (a delete replaces it with nothing). */
function replaceAnchor(text: string, anchor: string, replacement: string, span: Span, verb: string): Outcome {
  const index = text.indexOf(anchor);
  if (index < 0) return { ok: false, reason: `anchor not found: ${anchor}` };
  if (overlapsProtected(index, anchor.length, span))
    return { ok: false, reason: `cannot ${verb} inside a protected region` };
  return { ok: true, text: text.slice(0, index) + replacement + text.slice(index + anchor.length) };
}

function applyOne(text: string, edit: SkillEdit, span: Span): Outcome {
  const op = edit.op;
  // An empty anchor matches at offset 0: an `insert_after` without one landed above the
  // frontmatter, and the skill silently lost its name and its `trainable` flag.
  const anchor = typeof edit.anchor === "string" ? edit.anchor : undefined;
  if (ANCHORED_OPS.has(op) && !anchor?.trim()) {
    return { ok: false, reason: `${op} needs an anchor` };
  }
  const key = anchor ?? "";
  switch (op) {
    case "append":
      return appendEdit(text, edit);
    case "insert_after":
      return insertAfter(text, key, edit, span);
    case "replace":
      return replaceAnchor(text, key, String(edit.text ?? ""), span, "replace");
    case "delete":
      return replaceAnchor(text, key, "", span, "delete");
    default:
      return { ok: false, reason: `unknown op: ${String(op)}` };
  }
}
