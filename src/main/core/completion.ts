import { chatDeltas } from "./chat-deltas.ts";
/**
 * Completion: `engine.complete`, one direct call to a model (a planner's chat reply, a judge's or
 * reviewer's verdict), streamed into the thread that asked and stoppable through `engine.abort`.
 * The counterpart of `DelegationService`. Composed by the `engine` RPC group; its state stays in
 * the core.
 */
import { ChatActivityPhase, SessionActivityRole } from "../../shared/chat-activity.ts";
import {
  type CompletionCallPayload,
  type CompletionProvenance,
  CustomEvent,
  customEventData,
  isCompletionRole,
} from "../../shared/custom-events.ts";
import { type CompleteResponse, EngineFailureKind } from "../../shared/engine-requests.ts";
import type { HostMethod, HarnessParams, HarnessResult, WorkClass } from "../../shared/harness-api.ts";
import { EngineId } from "../../shared/providers.ts";
import { UiEvent } from "../../shared/ui-events.ts";
import { workClassOf } from "../../substrate/budget.ts";
import { type CompleteRequest, EngineError } from "../../substrate/engines/types.ts";
import { uuidv7 } from "../../substrate/ids.ts";
import type { CoreInternals, StudioCore } from "../studio-core.ts";
import { withFallbacks } from "./engine-failure.ts";
import { threadOr } from "./main-thread.ts";

/** Why a completion request is refused. */
const MESSAGE = {
  delegatedEngine: (engineId: string) => `${engineId} is a delegated engine; use engine.delegate`,
} as const;

type CompleteParams = HarnessParams<typeof HostMethod.EngineComplete>;

/** The chat stream one completion writes its reply into. */
interface ChatStream {
  readonly threadId: string;
  readonly streamId: string;
}

/** One call as its record needs it: what was asked, of which engine, in which class, and when. */
interface CallRecordInput {
  readonly p: CompleteParams;
  readonly engineId: string;
  readonly workClass: WorkClass;
  readonly startedAt: number;
}

/** A failed call's kind: the engine's own, or `other` for anything that is not an engine error. */
function failureKindOf(err: unknown): EngineFailureKind {
  return err instanceof EngineError ? err.kind : EngineFailureKind.Other;
}

/** The provenance fields the caller gave, each kept only when it has the type the record keeps. */
function provenanceOf(given: CompletionProvenance | undefined): CompletionProvenance {
  if (!given || typeof given !== "object") return {};
  const { role, runId, fellBack, promptSha256 } = given;
  return {
    ...(isCompletionRole(role) ? { role } : {}),
    ...(typeof runId === "string" ? { runId } : {}),
    ...(typeof fellBack === "boolean" ? { fellBack } : {}),
    ...(typeof promptSha256 === "string" ? { promptSha256 } : {}),
  };
}

/**
 * Is this a tool-registry revision the core has reached: a whole number from 0 up to the current
 * one? Anything else a caller sends is not recorded as applied.
 */
export function isAppliedRevision(revision: number | undefined, current: number): revision is number {
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 && revision <= current;
}

export class CompletionService {
  readonly #core: StudioCore;
  readonly #x: CoreInternals;
  readonly #deltas = new WeakMap<ChatStream, ReturnType<typeof chatDeltas>>();

  constructor(core: StudioCore, x: CoreInternals) {
    this.#core = core;
    this.#x = x;
  }

  async complete(p: CompleteParams): Promise<HarnessResult<typeof HostMethod.EngineComplete>> {
    const engineId = p.engine ?? EngineId.Ollama;
    const engine = this.#core.engines.get(engineId);
    if (!engine.complete) throw new Error(MESSAGE.delegatedEngine(engineId));
    const workClass = workClassOf(p.class);
    this.#core.budget.assertAllowed(workClass);
    const abort = new AbortController();
    const stream = p.stream === false ? null : await this.#openStream(threadOr(this.#core, p.threadId));
    const request = this.#request(p, engineId, abort.signal, stream);
    const release = this.#trackInFlight(p.threadId, abort);
    this.#core.budget.beginWork(workClass);
    const call: CallRecordInput = { p, engineId, workClass, startedAt: Date.now() };
    try {
      if (p.threadId && isAppliedRevision(p.toolRegistryRevision, this.#x.toolRegistryRevision))
        await this.#x.recordToolRevision(p.threadId, engineId, p.toolRegistryRevision);
      const response = await engine.complete(request);
      this.#core.budget.recordUsage(workClass, response.usage);
      if (stream) this.#endStream(stream, false);
      await this.#recordCall(call, response, null);
      return response;
    } catch (err) {
      if (stream) this.#endStream(stream, true);
      await this.#recordCall(call, null, err);
      throw await withFallbacks(this.#core.engines, engineId, err, { tools: Boolean(request.tools?.length) });
    } finally {
      this.#core.budget.endWork(workClass);
      release();
    }
  }

  /**
   * The call's `completion_call` record, on the thread that asked (the studio's own when none did),
   * so every caller of `engine.complete` is covered whatever it records itself. A record that
   * cannot be written never fails the call.
   */
  async #recordCall(call: CallRecordInput, response: CompleteResponse | null, err: unknown): Promise<void> {
    const { p, engineId, workClass, startedAt } = call;
    const payload = {
      engine: engineId,
      requestedModel: p.model ?? null,
      model: response?.model ?? null,
      usage: response?.usage ?? null,
      stopReason: response?.stopReason ?? null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      workClass,
      ok: response !== null,
      failure: response ? null : failureKindOf(err),
      ...provenanceOf(p.provenance),
    } satisfies CompletionCallPayload;
    await this.#core
      .append([customEventData(CustomEvent.CompletionCall, payload)], threadOr(this.#core, p.threadId))
      .catch(() => {});
  }

  async #openStream(threadId: string): Promise<ChatStream> {
    const stream = { threadId, streamId: uuidv7() };
    this.#core.emit(UiEvent.ChatStreamStarted, { ...stream, afterEventId: await this.#core.store.head(threadId) });
    this.#deltas.set(
      stream,
      chatDeltas((delta) => this.#core.emit(UiEvent.ChatDelta, delta)),
    );
    return stream;
  }

  #endStream(stream: ChatStream, failed: boolean): void {
    this.#deltas.get(stream)?.flush();
    this.#deltas.delete(stream);
    this.#core.emit(UiEvent.ChatStreamEnded, { ...stream, ...(failed ? { failed } : {}) });
  }

  /** The engine request: the caller's fields, plus the hooks that report context, activity and the reply. */
  #request(p: CompleteParams, engineId: string, signal: AbortSignal, stream: ChatStream | null): CompleteRequest {
    const reply = { started: false };
    const role = stream ? SessionActivityRole.Planner : SessionActivityRole.Reviewer;
    return {
      messages: p.messages,
      onContext: (measurement) => {
        if (p.threadId)
          void this.#core.append(
            [customEventData(CustomEvent.ContextUsage, { ...measurement, requestedModel: p.model ?? null })],
            p.threadId,
          );
      },
      onActivity: (phase) => {
        reply.started = false;
        if (p.threadId)
          void this.#core.append(
            [customEventData(CustomEvent.SessionActivity, { engine: engineId, phase, role })],
            p.threadId,
          );
      },
      signal,
      ...(p.model ? { model: p.model } : {}),
      ...(p.systemPrompt ? { systemPrompt: p.systemPrompt } : {}),
      ...(p.tools ? { tools: p.tools } : {}),
      ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
      ...(p.effort ? { effort: p.effort } : {}),
      ...(p.preferences ? { preferences: p.preferences } : {}),
      ...(p.timeoutMs ? { timeoutMs: p.timeoutMs } : {}),
      ...(stream ? { onDelta: (delta: string) => this.#streamDelta(stream, engineId, reply, delta) } : {}),
    };
  }

  /** One piece of the reply, streamed to the chat; the first one marks the session as responding. */
  #streamDelta(stream: ChatStream, engineId: string, reply: { started: boolean }, delta: string): void {
    if (delta && !reply.started) {
      reply.started = true;
      void this.#core.append(
        [
          customEventData(CustomEvent.SessionActivity, {
            engine: engineId,
            phase: ChatActivityPhase.Responding,
            role: SessionActivityRole.Planner,
          }),
        ],
        stream.threadId,
      );
    }
    this.#deltas.get(stream)?.push({ delta, threadId: stream.threadId, streamId: stream.streamId });
  }

  /**
   * Register the call under its thread, so `engine.abort` reaches it; the answer takes it off
   * again. A call that names no thread is not registered.
   */
  #trackInFlight(threadId: string | undefined, abort: AbortController): () => void {
    if (!threadId) return () => {};
    const inFlight = this.#x.activeCompletions.get(threadId) ?? new Set<AbortController>();
    inFlight.add(abort);
    this.#x.activeCompletions.set(threadId, inFlight);
    return () => {
      inFlight.delete(abort);
      if (inFlight.size === 0) this.#x.activeCompletions.delete(threadId);
    };
  }
}
