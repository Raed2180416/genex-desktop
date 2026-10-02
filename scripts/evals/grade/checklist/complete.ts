/**
 * The graders' one seam to a model: `GraderComplete` asks one pinned grader one prompt with its
 * frames and answers with the text, the served model and normalized tokens. Production binds it to
 * the app's own engines (`engineGraderComplete`), so a grader call is contained exactly as the app's
 * judges are; tests bind it to a fake and never reach a provider.
 */
import type { TokenUsage } from "../../../../src/shared/eval-lane.ts";
import { MINUTE_MS } from "../../../../src/shared/duration.ts";
import type { MessageImage, Usage } from "../../../../src/shared/event-log.ts";
import { EngineId } from "../../../../src/shared/providers.ts";
import type { CompleteRequest, CompleteResponse } from "../../../../src/substrate/engines/types.ts";
import type { GraderPin } from "../types.ts";

/** How long one grader call may take before the engine reports a timeout. */
export const GRADER_CALL_TIMEOUT_MS = 3 * MINUTE_MS;

/** One grader question: the rendered prompt and the frames it is about. */
export interface GraderPrompt {
  text: string;
  images: MessageImage[];
}

/** One grader answer. */
export interface GraderReply {
  text: string;
  /** The model the engine reports it was served by. */
  model: string;
  usage: TokenUsage;
}

/** Ask one pinned grader one question. Throws when the call fails; the caller counts it as invalid. */
export type GraderComplete = (pin: GraderPin, prompt: GraderPrompt) => Promise<GraderReply>;

/** The part of an app engine a grader uses: its toolless one-shot `complete()`. */
export interface CompletingEngine {
  complete(request: CompleteRequest): Promise<CompleteResponse>;
}

/** A grader pin names an engine this process has no instance of. */
export class GraderEngineMissing extends Error {
  readonly engine: EngineId;
  constructor(engine: EngineId) {
    super(`no grading engine for ${engine}`);
    this.name = "GraderEngineMissing";
    this.engine = engine;
  }
}

/**
 * An engine's usage in the eval's normalized shape (Rule 13). Codex's input count includes its
 * cached input and folds reasoning into output; Anthropic's input excludes the cache. Neither
 * engine reports reasoning separately here, so it stays 0 and is never added twice.
 */
export function tokenUsageFromEngine(engine: EngineId, usage: Usage): TokenUsage {
  const input = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_tokens ?? 0;
  const uncachedInput = engine === EngineId.Codex ? Math.max(0, input - cacheRead) : input;
  return {
    uncachedInput,
    cacheWrite: usage.cache_write_tokens ?? 0,
    cacheRead,
    output: usage.output_tokens ?? 0,
    reasoning: 0,
  };
}

/** The `complete()` request one grader question becomes: one user message with its frames, no tools. */
export function graderCompleteRequest(pin: GraderPin, prompt: GraderPrompt): CompleteRequest {
  return {
    model: pin.model,
    effort: pin.effort,
    messages: [{ role: "user", content: prompt.text, images: prompt.images }],
    timeoutMs: GRADER_CALL_TIMEOUT_MS,
  };
}

/** Bind `GraderComplete` to the app's engines, keyed by engine id. */
export function engineGraderComplete(engines: Partial<Record<EngineId, CompletingEngine>>): GraderComplete {
  return async (pin, prompt) => {
    const engine = engines[pin.engine];
    if (!engine) throw new GraderEngineMissing(pin.engine);
    const response = await engine.complete(graderCompleteRequest(pin, prompt));
    return {
      text: response.message.content,
      model: response.model,
      usage: tokenUsageFromEngine(pin.engine, response.usage),
    };
  };
}
