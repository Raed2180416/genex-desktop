import { randomUUID } from "node:crypto";
import { StopReason } from "../../shared/engine-requests.ts";
import { ReasoningEffort } from "../../shared/model-preferences.ts";
import type { Message } from "../types.ts";
import { CHECKPOINT_PROMPT, checkpointRequest, OMITTED_MIDDLE } from "./local-session-prompts.ts";
import type { CompleteRequest, CompleteResponse } from "./types.ts";

/**
 * The response cap includes Bonsai's low-effort reasoning reserve (512 tokens).
 * 1,024 left too little room for the requested checkpoint in a real session.
 */
const CHECKPOINT_REPLY_TOKENS = 2048;
/** A history chunk is at least this many characters, however small the context. */
const MIN_CHUNK_CHARS = 2048;
/** A chunk takes this share of the context (in tokens), at about three characters a token. */
const CHUNK_CONTEXT_SHARE = 0.45;
const CHARS_PER_TOKEN = 3;

const MESSAGE = {
  Incomplete: "Checkpoint generation was incomplete; previous context is preserved.",
} as const;

export interface LocalCheckpoint {
  id: string;
  parent?: string;
  summary: string;
  completedActions: Array<{ id: string; name: string }>;
  createdAt: string;
}
/** Cut only BEFORE an assistant round: no call/result pair is split. */
export function checkpointCut(messages: Message[], keepRounds = 2): number {
  if (keepRounds === 0) return messages.length;
  const rounds = messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  return rounds.length > keepRounds ? (rounds.at(-keepRounds) ?? 0) : 0;
}
export async function summarizeLocalCheckpoint(input: {
  messages: Message[];
  previous?: LocalCheckpoint;
  model: string;
  signal: AbortSignal;
  complete: (r: CompleteRequest) => Promise<CompleteResponse>;
  contextWindow: number;
}): Promise<LocalCheckpoint> {
  const { messages, previous, model, signal, complete } = input;
  signal.throwIfAborted();
  const answered = new Set(messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  const completed = new Map((previous?.completedActions ?? []).map((a) => [a.id, a]));
  for (const m of messages)
    for (const c of m.tool_calls ?? []) if (answered.has(c.id)) completed.set(c.id, { id: c.id, name: c.name });
  // Incremental chunks keep the summarizer itself inside the working context. Every chunk
  // participates; large results retain their ends and an explicit archive reference.
  const limit = Math.max(MIN_CHUNK_CHARS, Math.floor(input.contextWindow * CHUNK_CONTEXT_SHARE) * CHARS_PER_TOKEN);
  let summary = previous?.summary ?? "";
  let chunk = "";
  const flush = async () => {
    if (!chunk) return;
    signal.throwIfAborted();
    const response = await complete({
      model,
      signal,
      systemPrompt: CHECKPOINT_PROMPT,
      messages: [{ role: "user", content: checkpointRequest(summary, chunk) }],
      maxTokens: CHECKPOINT_REPLY_TOKENS,
      effort: ReasoningEffort.Low,
    });
    signal.throwIfAborted();
    if (response.stopReason === StopReason.Length || !response.message.content.trim())
      throw new Error(MESSAGE.Incomplete);
    summary = response.message.content.trim();
    chunk = "";
  };
  for (const m of messages) {
    const part = recordedMessage(m, limit);
    if (chunk.length + part.length > limit) await flush();
    chunk += `${part}\n`;
  }
  await flush();
  return {
    id: randomUUID(),
    ...(previous ? { parent: previous.id } : {}),
    summary,
    completedActions: [...completed.values()],
    createdAt: new Date().toISOString(),
  };
}

/** One message as the summarizer reads it; one longer than a chunk keeps only its two ends. */
function recordedMessage(m: Message, limit: number): string {
  const raw = JSON.stringify({
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls,
    tool_call_id: m.tool_call_id,
  });
  if (raw.length <= limit) return raw;
  const half = Math.floor(limit / 2);
  return raw.slice(0, half) + OMITTED_MIDDLE + raw.slice(-half);
}
