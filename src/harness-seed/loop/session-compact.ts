/**
 * Compact now for a chat whose engine keeps a provider session (Claude Code, Codex, a local
 * session). A summary of the log changes nothing there: the next turn would resume the same
 * session, history and all.
 *
 * An engine with a compaction of its own (Claude Code's `/compact`, Codex's app server) compacts
 * the session in place, and the next turn resumes it. Any other session, or
 * one whose own compaction did not run, writes a handover in one read-only turn, and the chat's
 * next turn starts a fresh session briefed with it: the host forgets every session before that
 * `compacted` event (shared/chat-rewind.ts `harnessView`).
 */
import { goesOn } from "./chat-continuity.ts";
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
/** The provider's own compaction: a summary of the whole session, minutes for a long one. */
const NATIVE_COMPACT_MS = 10 * MINUTE_MS;
/** Room for a look at a file or two before the reply; never a build. */
const HANDOVER_MAX_TURNS = 4;
/** The person's latest asks whose exchanges stay verbatim after the handover, beside it. */
const KEPT_ASKS = 4;

/**
 * Compact now on the chat's session. On an engine with a compaction of its own (`native`), the
 * session compacts itself in place first; otherwise, or when that did not run, the session writes
 * its handover. Null when the chat has no session of this engine to ask; not compacted when it
 * wrote none (the caller then summarises the log instead).
 */
export async function compactSession(
  ctx: HarnessCtx,
  { threadId, engine, model, native = false }: ChatCompaction & { native?: boolean },
): Promise<CompactResult | null> {
  const events: HarnessEvent[] = await ctx.call(HostMethod.EventsList, { threadId });
  // Only the chat's latest session is compacted: one another model answered after is not its.
  const found = goesOn(lastContractorSession(events), engine);
  if (!found?.sessionId || !found.project) return null;
  await appendCustom(ctx, threadId, RunEvent.SessionActivity, { phase: COMPACTING_PHASE, engine, model });
  const chat: SessionCompaction = {
    threadId,
    engine,
    model,
    events,
    session: { sessionId: found.sessionId, project: found.project },
  };
  const own = native ? await compactNatively(ctx, chat) : null;
  return own?.compacted ? own : writeHandover(ctx, chat);
}

/**
 * The chat's session compacts itself with its provider's own compaction and goes on under the same
 * id: the `compacted` event says so (`native`), so the next turn resumes it. Claude Code reports
 * its summary, which stands in for the log when a fresh session must be briefed after all; Codex
 * keeps its own sealed in the session. Not compacted when the provider did not compact.
 */
async function compactNatively(ctx: HarnessCtx, chat: SessionCompaction): Promise<CompactResult> {
  const { threadId, engine, model, events, session } = chat;
  const turn = await ctx
    .call(HostMethod.EngineDelegate, {
      engine,
      project: session.project,
      threadId,
      prompt: "",
      resume: session.sessionId,
      compact: true,
      readOnly: true,
      timeoutMs: NATIVE_COMPACT_MS,
      ...(model ? { model } : {}),
    })
    .catch(() => null);
  if (!turn?.compacted) return { compacted: false, reason: turn?.errorText || "the provider did not compact" };
  const summary = String(turn.summary ?? "").trim();
  const messages = eventsToMessagesWithSources(events).messages.length;
  await appendCustom(ctx, threadId, RunEvent.Compacted, {
    ...(summary ? { summary } : {}),
    native: true,
    parentCheckpoint: latestCompaction(events)?.id ?? null,
    engine,
    model: model ?? null,
    messages,
    trigger: "manual",
    sessionId: session.sessionId,
  });
  ctx.notify("thread.compacted", { threadId, messages });
  return { compacted: true, messages };
}

/** The chat's session writes its handover in one read-only turn, recorded as the chat's `compacted` event. */
async function writeHandover(ctx: HarnessCtx, chat: SessionCompaction): Promise<CompactResult> {
  const { threadId, engine, model, events, session } = chat;
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

/** Which chat is compacted, on which engine and model. */
interface ChatCompaction {
  threadId: string;
  engine: string;
  model?: string | undefined;
}

/** A compaction of the chat's session: its log as it was read, and the session it works on. */
interface SessionCompaction extends ChatCompaction {
  events: HarnessEvent[];
  session: { sessionId: string; project: string };
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
