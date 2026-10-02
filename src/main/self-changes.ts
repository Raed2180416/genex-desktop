/**
 * Studio's learned changes to its own instructions, as the host handles them: which file a
 * staged suggestion may write, what it should leave in that file today, and which files an
 * applied change owns when someone undoes it.
 *
 * The harness writes the staged list over RPC and edits its own code, so nothing in a staged
 * record is trusted as a path, and nothing is written over a file it was not made for.
 */
import { applyEdits } from "../shared/skill-edits.ts";
import type { EventEnvelope } from "../substrate/types.ts";
import { CustomEvent } from "../shared/custom-events.ts";
import { EventKind } from "../shared/event-log.ts";
import { SKILL_SLUG, agentChangedFile, isWorkspaceRelative } from "../shared/self-change-files.ts";

export interface StagedRecord {
  skill: string;
  file: string;
  proposedText: string;
  currentText?: string;
  edits?: unknown;
  gate?: unknown;
  rationale?: string;
  title?: string;
  summary?: string[];
  at?: string;
}

/** What the user reads when a staged suggestion cannot be applied. */
const MESSAGE = {
  damaged: "This suggestion is damaged, so Studio did not apply it. Discard it.",
} as const;

/** A suggestion that can never be applied as it stands — not a passing failure worth retrying. */
export class SuggestionRefused extends Error {}

/** The one file a suggestion may write: `skills/<skill>.md`, and nothing a `..` could reach. */
export function proposalTarget(proposal: StagedRecord): { skill: string; file: string } {
  const skill = typeof proposal?.skill === "string" ? proposal.skill : "";
  const wellFormed =
    SKILL_SLUG.test(skill) && proposal.file === `skills/${skill}.md` && typeof proposal.proposedText === "string";
  if (!wellFormed) throw new SuggestionRefused(MESSAGE.damaged);
  return { skill, file: proposal.file };
}

/**
 * The text a suggestion should leave in its file now. A suggestion carries the whole file as
 * it would read after the change, written against the text it was staged on; writing that over
 * a file another change had edited since undid that change without a trace (two approvals of
 * one file, 2026-09-03). So it lands whole only on the text it was written for; otherwise its
 * own edits are replayed on the current text — all of them, or it is refused.
 */
export function rebaseProposal(proposal: StagedRecord, current: string): string {
  if (proposal.currentText === current) return proposal.proposedText;
  const edits = Array.isArray(proposal.edits) ? proposal.edits : [];
  if (edits.length > 0 && typeof proposal.currentText === "string") {
    const original = applyEdits(proposal.currentText, edits);
    if (original.applied.length > 0 && original.text === proposal.proposedText) {
      const replay = applyEdits(current, original.applied);
      if (replay.applied.length === original.applied.length) return replay.text;
    }
  }
  throw new SuggestionRefused(
    "Studio’s instructions changed after this suggestion was made, and it no longer fits. Discard it; Studio will suggest again after a later build.",
  );
}

/**
 * A suggestion is named by when it was made and what it changes. An index names whatever sits
 * there now — after an automatic apply or a new suggestion, a different one.
 */
export function findStaged(staged: StagedRecord[], index: number, key?: { at?: string; skill?: string }): number {
  if (key?.at)
    return staged.findIndex((proposal) => proposal.at === key.at && (!key.skill || proposal.skill === key.skill));
  return staged[index] ? index : -1;
}

/** One applied change to Studio's own files, as the log recorded it. */
export interface ChangeRecord {
  /** The snapshot taken just before the change: its identity, and the version an undo returns to. */
  snapshotId: string;
  /** The snapshot taken just after it, when the change recorded one. */
  postSnapshotId?: string;
  /** The file the change wrote; an undo touches nothing else. */
  file: string;
  skill?: string;
  edits?: unknown;
  at: string;
}

/** Every applied change in the log, oldest first. */
export function changeRecords(events: EventEnvelope[]): ChangeRecord[] {
  return events.flatMap((event) => {
    const change = changeRecord(event);
    return change ? [change] : [];
  });
}

/**
 * The applied change one log record describes: an accepted skill edit, an architect's change, or
 * one the agent made to its own files (`write_own_file`, `write_skill`, `install_tool`).
 */
function changeRecord(event: EventEnvelope): ChangeRecord | null {
  if (event.data.type !== EventKind.Custom) return null;
  const p = (event.data.payload ?? {}) as Record<string, unknown>;
  if (typeof p.snapshot_id !== "string" || !p.snapshot_id) return null;
  const post =
    typeof p.post_snapshot_id === "string" && p.post_snapshot_id ? { postSnapshotId: p.post_snapshot_id } : {};
  const changed = { snapshotId: p.snapshot_id, ...post, at: event.created_at };
  const type = event.data.event_type;
  if (type === CustomEvent.SkilloptAccepted) {
    if (typeof p.skill !== "string" || !SKILL_SLUG.test(p.skill)) return null;
    return { ...changed, file: `skills/${p.skill}.md`, skill: p.skill, edits: p.edits };
  }
  if (type === CustomEvent.ImprovementApplied) {
    if (typeof p.file !== "string" || !isWorkspaceRelative(p.file)) return null;
    return { ...changed, file: p.file };
  }
  // The agent's own edit is not SkillOpt's: no `skill`, so an undo leaves SkillOpt's memory alone.
  const file = agentChangedFile(type, p);
  return file ? { ...changed, file } : null;
}

/**
 * Files the harness runs. A snapshot that differs from a healthy one only in files it reads —
 * skills, prompts, the library — boots and turns exactly as that one did.
 */
export const RUNS_AS_CODE = /\.(?:mjs|cjs|js|ts)$|(?:^|\/)package\.json$/;
