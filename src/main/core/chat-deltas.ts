import type { ChatDelta } from "../../shared/ui-events.ts";

const CHAT_DELTA_FLUSH_MS = 33;
const CHAT_DELTA_MAX_CHARS = 64_000;

/** Coalesce one stream's token pushes while preserving replace semantics and explicit flushes. */
export function chatDeltas(emit: (delta: ChatDelta) => void) {
  let pending: ChatDelta | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const value = pending;
    pending = null;
    if (value) emit(value);
  };
  const push = (delta: ChatDelta) => {
    const changedStream = pending && (pending.threadId !== delta.threadId || pending.streamId !== delta.streamId);
    if (changedStream) flush();
    if (!pending || delta.replace) pending = { ...delta };
    else pending = { ...pending, delta: (pending.delta ?? "") + (delta.delta ?? "") };
    if ((pending.delta?.length ?? 0) >= CHAT_DELTA_MAX_CHARS) flush();
    else timer ??= setTimeout(flush, CHAT_DELTA_FLUSH_MS);
  };
  return { push, flush };
}
