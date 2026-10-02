/**
 * The journal a run resumes from: the artifact it is saved under on the run's thread, and reading
 * it back. Saving it, failures logged, is run-events.ts `saveJournal`.
 */
import { HostMethod } from "./host-methods.ts";
import type { AnyRecord, HarnessCtx } from "../types/harness.d.ts";

/** The artifact a run's journal is saved under: `autopilot_<runId>`, for every mode. */
export function journalId(runId: string): string {
  return `autopilot_${runId}`;
}

/** A run's saved journal, or null when there is none (or it cannot be read). */
export async function readJournal(
  host: Pick<HarnessCtx, "call">,
  threadId: string,
  runId: string,
): Promise<AnyRecord | null> {
  return (await host
    .call(HostMethod.ArtifactRead, { threadId, artifactId: journalId(runId) })
    .catch(() => null)) as AnyRecord | null;
}

/** Write a run's journal, and let a failure reach the caller (run-events.ts `saveJournal` logs it instead). */
export async function writeJournal(
  ctx: Pick<HarnessCtx, "call">,
  threadId: string,
  runId: string,
  journal: unknown,
): Promise<void> {
  await ctx.call(HostMethod.ArtifactWrite, { threadId, artifactId: journalId(runId), value: journal });
}
