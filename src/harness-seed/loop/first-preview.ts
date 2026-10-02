/**
 * The first time a project's preview came up after a build: how long it took from the start of
 * that build, and which signal said so (`preview_ready`). The evals read "time to first preview"
 * from it; the chat keeps no such clock of its own. Written once per project on a thread: a later
 * build's ready preview is not a first one.
 */
import { HostMethod } from "./host-methods.ts";
import { EventKind, RunEvent } from "./run-events.ts";
import type { AnyRecord, HarnessCtx } from "../types/harness.d.ts";
import type { ReadyResult } from "../types/host-api.d.ts";

/** The build a ready preview belongs to: its thread, project and run, and when it started. */
export interface BuildStart {
  threadId: string;
  project: string;
  runId?: string | null;
  startedAt: number;
}

/** The `preview_ready` payload for a ready answer, or null when the preview did not come up. */
export function firstPreviewPayload(
  build: BuildStart,
  ready: Pick<ReadyResult, "ready" | "via"> | null | undefined,
  readyAt: number,
): AnyRecord | null {
  if (ready?.ready !== true) return null;
  return {
    project: build.project,
    ...(build.runId ? { runId: build.runId } : {}),
    ms: Math.max(0, readyAt - build.startedAt),
    via: ready.via,
  };
}

/** Has this thread already recorded a first preview for the project? */
function recordedBefore(events: readonly AnyRecord[], project: string): boolean {
  return events.some((event) => {
    const data = event?.data;
    return (
      data?.type === EventKind.Custom && data.event_type === RunEvent.PreviewReady && data.payload?.project === project
    );
  });
}

/**
 * Record the project's first ready preview on the build's thread, once. A harness whose kept
 * `run-events.ts` predates the record writes nothing; a failed read or write never fails the build.
 */
export async function recordFirstPreview(
  ctx: HarnessCtx,
  build: BuildStart,
  ready: Pick<ReadyResult, "ready" | "via"> | null | undefined,
  readyAt: number,
): Promise<boolean> {
  const payload = firstPreviewPayload(build, ready, readyAt);
  if (!payload || !RunEvent.PreviewReady) return false;
  try {
    const events = await ctx.call(HostMethod.EventsList, { threadId: build.threadId });
    if (recordedBefore(events as AnyRecord[], build.project)) return false;
    await ctx.call(HostMethod.EventsAppend, {
      threadId: build.threadId,
      batch: [{ type: EventKind.Custom, event_type: RunEvent.PreviewReady, payload }],
    });
    return true;
  } catch {
    return false;
  }
}
