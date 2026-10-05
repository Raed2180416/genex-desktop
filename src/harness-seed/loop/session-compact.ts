/**
 * Compact now for a chat whose engine keeps a provider session (Claude Code, Codex, a local
 * session). A summary of the log changes nothing there: the next turn would resume the same
 * session, history and all. So the session itself writes the handover, in one read-only turn, and
 * the chat's next turn starts a fresh session briefed with it: the host forgets every session
 * before a `compacted` event (shared/chat-rewind.ts `harnessView`). No provider's own compaction
 * is asked for, so it works the same for every engine.
 */
import { lastContractorSession } from "./chat-session.ts";
import { appendCustom, COMPACTING_PHASE, latestCompaction } from "./compaction-log.ts";
import { HostMethod } from "./host-methods.ts";
import { eventsToMessagesWithSources } from "./prompt.ts";
import { RunEvent } from "./run-events.ts";
import { MINUTE_MS } from "./time.ts";
import { SESSION_HANDOVER_ASK } from "./session-compact-prompts.ts";
import type { CompactResult } from "./compact.ts";
import type { HarnessCtx, HarnessEvent } from "../types/harness.d.ts";

/** The handover turn's budget: a reply, not a build. */
const HANDOVER_TURN_MS = 3 * MINUTE_MS;
/** Room for a look at a file or two before the reply; never a build. */
const HANDOVER_MAX_TURNS = 4;
/** The person's latest asks whose exchanges stay verbatim after the handover, beside it. */
const KEPT_ASKS = 4;

/**
 * The chat's session writes its handover, recorded as the chat's `compacted` event. Null when the
 * chat has no session of this engine to ask; not compacted when the session wrote none (the
 * caller then summarises the log instead).
 */
export async function compactSession(
  ctx: HarnessCtx,
  { threadId, engine, model }: { threadId: string; engine: string; model?: string | undefined },
): Promise<CompactResult | null> {
  const events: HarnessEvent[] = await ctx.call(HostMethod.EventsList, { threadId });
  const session = lastContractorSession(events, engine);
  if (!session?.sessionId || !session.project) return null;
  await appendCustom(ctx, threadId, RunEvent.SessionActivity, { phase: COMPACTING_PHASE, engine, model });
  const turn = await ctx
    .call(HostMethod.EngineDelegate, {
      engine,
      project: session.project,
      threadId,
      prompt: SESSION_HANDOVER_ASK,
      resume: session.sessionId,
      readOnly: true,
      maxTurns: HANDOVER_MAX_TURNS,
      timeoutMs: HANDOVER_TURN_MS,
      ...(model ? { model } : {}),
    })
    .catch(() => null);
  const summary = turn?.ok ? String(turn.summary ?? "").trim() : "";
  if (!summary) return { compacted: false, reason: "the session wrote no handover" };
  const { upTo, summarised } = summaryEnd(events);
  await appendCustom(ctx, threadId, RunEvent.Compacted, {
    summary,
    upTo,
    parentCheckpoint: latestCompaction(events)?.id ?? null,
    engine,
    model: model ?? null,
    messages: summarised,
    trigger: "manual",
    sessionId: session.sessionId,
  });
  ctx.notify("thread.compacted", { threadId, messages: summarised });
  return { compacted: true, messages: summarised };
}

/**
 * Where the handover takes over from the log (the fold in prompt.ts `replaceCompacted`), and how
 * many messages it replaces there: the first exchange always, and everything before the person's
 * last `KEPT_ASKS` asks, which stay verbatim beside it. A chat of one ask is the handover alone.
 */
function summaryEnd(events: readonly HarnessEvent[]): { upTo: string | null; summarised: number } {
  const { messages, sources } = eventsToMessagesWithSources(events);
  const asks = messages.flatMap((message, at) => (message.role === "user" ? [at] : []));
  const keptFrom = (asks.length > KEPT_ASKS ? asks.at(-KEPT_ASKS) : asks[1]) ?? messages.length;
  return { upTo: sources[keptFrom - 1] ?? null, summarised: keptFrom };
}
