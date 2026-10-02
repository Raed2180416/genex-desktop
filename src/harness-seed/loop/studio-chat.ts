import { eventsToMessages, windowMessagesToBudget } from "./prompt.ts";
import type { HarnessCtx, HarnessEvent } from "../types/harness.d.ts";
import type { CompleteResponse, Message, ModelPreferences, ReferenceFrame } from "../types/host-api.d.ts";
import { HostMethod } from "./host-methods.ts";
import { EventKind, RunEvent } from "./run-events.ts";
import { EngineFailure } from "./outage.ts";
import { MINUTE_MS } from "./time.ts";
import { TurnStop } from "./turn-record.ts";
import { OMITTED_HISTORY, studioSystemPrompt } from "./studio-chat-prompts.ts";
import { RoleKey } from "./model-roles.ts";

/** How long one Studio reply may take. */
const REPLY_TIMEOUT_MS = 2 * MINUTE_MS;
/** The longest Studio reply, in tokens. */
const REPLY_MAX_TOKENS = 2048;
/** The context window assumed when the engine's is unknown. */
const DEFAULT_CONTEXT_WINDOW = 32_000;
/** The share of the context window the conversation may fill, and its floor and ceiling in tokens. */
const HISTORY_SHARE = 0.4;
const HISTORY_MIN_TOKENS = 1000;
const HISTORY_MAX_TOKENS = 10_000;
/** Stills the latest message may carry to the model. */
const MAX_STILLS = 4;

/** One turn in the Studio's own conversation. */
export interface StudioTurnOptions {
  threadId: string;
  turnId: string;
  engine?: string;
  model?: string;
  effort?: string;
  preferences?: ModelPreferences;
  contextWindow?: number | null;
  stills?: ReferenceFrame[];
}

/** How a Studio turn ended. */
type StudioTurnOutcome = { stopped: string; round: number; engine: string | undefined };

/** Every provider uses its tool-free completion path here: Studio is a conversation, not a build. */
export async function runStudioTurn(ctx: HarnessCtx, options: StudioTurnOptions): Promise<StudioTurnOutcome> {
  const { threadId, turnId, engine, model } = options;
  const cancelled = async (): Promise<StudioTurnOutcome> => {
    await ctx.call(HostMethod.TurnAppend, { turnId, batch: [{ type: EventKind.Error, message: "cancelled" }] });
    return { stopped: TurnStop.Cancelled, round: 0, engine };
  };
  const [events, context] = await Promise.all([
    ctx.call(HostMethod.EventsList, { threadId }),
    ctx.call(HostMethod.StudioContext),
  ]);
  if (ctx.cancelled) return cancelled();
  const messages = studioMessages(events, options);
  ctx.setStatus?.("thinking");
  let response: CompleteResponse;
  try {
    response = await ctx.call(HostMethod.EngineComplete, {
      engine,
      model,
      threadId,
      messages,
      timeoutMs: REPLY_TIMEOUT_MS,
      maxTokens: REPLY_MAX_TOKENS,
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.preferences ? { preferences: options.preferences } : {}),
      systemPrompt: studioSystemPrompt(context),
    });
  } catch (error: any) {
    if (ctx.cancelled || error?.kind === EngineFailure.Aborted) return cancelled();
    throw error;
  }
  if (ctx.cancelled) return cancelled();
  const content = response.message?.content?.trim();
  if (!content) throw new Error("Studio received an empty reply. Please try sending your message again.");
  await ctx.call(HostMethod.TurnAppend, {
    turnId,
    batch: [{ type: EventKind.Messages, messages: [{ role: "assistant", content }], usage: response.usage }],
  });
  if ((response.usage?.input_tokens as number) > 0) await recordUsage(ctx, options, response);
  ctx.notify("chat.message", { role: "assistant", content });
  return { stopped: TurnStop.Done, round: 1, engine };
}

/**
 * The conversation so far, fitted to the context window. Native completion adapters flatten
 * message content. Label roles explicitly so a previous answer (including the old canned
 * refusal) cannot become the next user's instruction.
 */
function studioMessages(events: readonly HarnessEvent[], options: StudioTurnOptions): Message[] {
  const budget = (options.contextWindow ?? DEFAULT_CONTEXT_WINDOW) * HISTORY_SHARE;
  const history = windowMessagesToBudget(
    eventsToMessages(events).filter((m) => ["user", "assistant"].includes(m.role)),
    Math.min(HISTORY_MAX_TOKENS, Math.max(HISTORY_MIN_TOKENS, budget)),
  );
  const messages: Message[] = history.map((message) => ({
    role: message.role,
    content: labelled(message),
  }));
  const latestUser = messages.findLast((message) => message.role === "user");
  if (latestUser && options.stills?.length) latestUser.images = options.stills.slice(0, MAX_STILLS);
  return messages;
}

/** One message as the Studio model reads it: said by the User or by Studio, or the omission note. */
function labelled(message: Pick<Message, "role" | "content">): string {
  if (message.role === "system") return OMITTED_HISTORY;
  const speaker = message.role === "user" ? "User" : "Studio";
  return `${speaker}:\n${message.content}`;
}

/** Record how much of the context window the reply's prompt used. */
async function recordUsage(ctx: HarnessCtx, options: StudioTurnOptions, response: CompleteResponse): Promise<void> {
  const { turnId, engine, model } = options;
  const contextWindow = options.contextWindow ?? null;
  const promptTokens = response.usage?.input_tokens ?? 0;
  await ctx.call(HostMethod.TurnAppend, {
    turnId,
    batch: [
      {
        type: EventKind.Custom,
        event_type: RunEvent.ContextUsage,
        payload: {
          engine,
          model,
          requestedModel: model ?? null,
          role: RoleKey.Planner,
          source: "provider",
          promptTokens: response.usage?.input_tokens,
          contextWindow,
          percent: contextWindow ? Math.round((promptTokens / contextWindow) * 100) : null,
        },
      },
    ],
  });
}
