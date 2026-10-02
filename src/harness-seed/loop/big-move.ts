/**
 * A reviewer's one big move for a part (`{ what, why }`): the bold step the taste judge and the
 * playtester name beside their defects. The golden-goal night's judges listed 189 defects and were
 * never asked for the one step their part needed; this is that step, as the director and a worker
 * read it. A module of its own, so a workspace that kept an older judge.ts still loads the parts
 * that read it.
 */
import { clip, CLIP_REASON } from "./text.ts";
import type { AnyRecord } from "../types/harness.d.ts";

/** What a judge gave as its big move, as a record: an object, a bare sentence, or nothing. */
function asProposal(raw: unknown): AnyRecord | null {
  if (typeof raw === "string") return { what: raw };
  return raw && typeof raw === "object" ? (raw as AnyRecord) : null;
}

/** A judge's big move for a part, or null when it named none: an object, or a bare sentence. */
export function normalizeBigMove(raw: unknown): { what: string; why: string } | null {
  const given = asProposal(raw);
  const what = typeof given?.what === "string" ? given.what.trim() : "";
  if (!what) return null;
  const why = typeof given?.why === "string" ? given.why.trim() : "";
  return { what: clip(what, CLIP_REASON), why: clip(why, CLIP_REASON) };
}
