import { markPerformance } from "../performance.tsx";
import { PerformanceMarkName } from "../../shared/performance.ts";
import { replyCommitted } from "./stream-reconciliation.ts";
import { type AnimationEvent, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFollowHeight } from "../ui/animate-height.tsx";
import { CLOSE_MS } from "../ui/motion.ts";
import { Markdown } from "../ui/Markdown.tsx";
import { prefersReducedMotion } from "../ui/media-queries.ts";
import { PresencePhase } from "../ui/presence-list.ts";
import type { EventEnvelope } from "../types.ts";
import { isHandoffNarration } from "../../shared/chat-presentation.ts";
import { isUiEventIn, UiEvent } from "../../shared/ui-events.ts";

type Stream = { thread: string; text: string; id?: string; after?: string; committedId?: string };
type ChatEvent = Extract<UiEvent, { type: `chat.${string}` }>;

/** How many threads' in-flight replies the cache keeps; the oldest goes first. */
const STREAM_CACHE_CAP = 32;
/** How often, at most, a streaming reply re-renders. */
const FLUSH_MS = 50;

type StreamEvent = Extract<ChatEvent, { type: typeof UiEvent.ChatStreamStarted | typeof UiEvent.ChatDelta }>;

/** Does this event begin a new stream: a start, or a delta of a stream the cache does not hold? */
function beginsStream(event: ChatEvent, current: Stream | undefined): event is StreamEvent {
  if (event.type === UiEvent.ChatStreamStarted) return true;
  return event.type === UiEvent.ChatDelta && event.payload.streamId !== current?.id;
}

/** Does this event end the thread's stream without a reply: an error, or its failed end? */
function dropsStream(event: ChatEvent, current: Stream | undefined): boolean {
  if (event.type === UiEvent.ChatError) return true;
  return (
    event.type === UiEvent.ChatStreamEnded && Boolean(event.payload.failed) && event.payload.streamId === current?.id
  );
}

/** Put a thread's stream in the cache as its newest, forgetting the oldest past the cap. */
function cacheStream(cache: Map<string, Stream>, value: Stream): void {
  cache.delete(value.thread);
  cache.set(value.thread, value);
  if (cache.size <= STREAM_CACHE_CAP) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/**
 * Fold one chat event into its thread's cached stream. `after` is where a new stream starts in the
 * transcript when the event does not say (the newest loaded entry, for the thread on screen).
 */
function foldChatEvent(cache: Map<string, Stream>, event: ChatEvent, thread: string, after: string | undefined): void {
  let value = cache.get(thread);
  if (beginsStream(event, value)) {
    value = { thread, text: "", id: event.payload.streamId, after: event.payload.afterEventId ?? after };
    cacheStream(cache, value);
  }
  if (dropsStream(event, value)) cache.delete(thread);
  if (!value) return;
  if (event.type === UiEvent.ChatStreamCommitted && event.payload.streamId === value.id)
    value.committedId = event.payload.eventId;
  if (event.type === UiEvent.ChatDelta && event.payload.delta)
    value.text = event.payload.replace ? event.payload.delta : value.text + event.payload.delta;
}

/** The opening's own animation (theme.css `.presence`), whose end means the reply is open. */
const REPLY_OPENING = "presence-open";

/** How long the reply takes to grow by a line: quick, as it glides for most of a stream. */
const LINE_GLIDE_MS = CLOSE_MS;

/**
 * The reply while it is written: it opens in place like everything that arrives, then grows
 * smoothly as its lines arrive instead of pushing the work line down a line at a time.
 */
function WritingReply({ text }: { text: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useFollowHeight(outer, inner, LINE_GLIDE_MS);
  const [opening, setOpening] = useState(() => !prefersReducedMotion());
  return (
    <div
      data-streaming-reply
      data-presence={opening ? PresencePhase.Open : PresencePhase.Shown}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && event.animationName === REPLY_OPENING) setOpening(false);
      }}
      className="presence min-w-0"
    >
      <div ref={outer} className="chat-grow">
        <div ref={inner} className="flow-root">
          <Markdown streaming text={text} />
        </div>
      </div>
    </div>
  );
}

/**
 * Token traffic stays in this leaf. A small cache preserves in-flight replies across navigation.
 * `onShowing` hears whether a reply is being written on screen, so the work before it can stay
 * in the transcript, where the saved reply will land.
 */
export const StreamingReply = memo(function StreamingReply({
  threadId,
  events,
  onShowing,
}: {
  threadId?: string;
  events: EventEnvelope[];
  onShowing?: (showing: boolean) => void;
}) {
  const cache = useRef(new Map<string, Stream>());
  const selected = useRef(threadId);
  selected.current = threadId;
  const latest = useRef(events.at(-1)?.id);
  latest.current = events.at(-1)?.id;
  const [stream, setStream] = useState<Stream>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const value = selected.current ? cache.current.get(selected.current) : undefined;
      setStream(value ? { ...value } : undefined);
    };
    const dispose = window.studio.onEvent((event) => {
      if (!isUiEventIn(event, "chat.")) return;
      const thread = event.payload.threadId;
      if (!thread) return;
      const onScreen = thread === selected.current;
      foldChatEvent(cache.current, event, thread, onScreen ? latest.current : undefined);
      if (!onScreen) return;
      if (event.type === UiEvent.ChatDelta) markPerformance(PerformanceMarkName.Delta);
      timer ??= setTimeout(flush, FLUSH_MS);
    });
    return () => {
      dispose();
      if (timer) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const value = threadId ? cache.current.get(threadId) : undefined;
    setStream(value ? { ...value } : undefined);
  }, [threadId]);
  const committed = Boolean(stream?.text && replyCommitted(stream, events));
  useEffect(() => {
    if (committed) {
      if (threadId && cache.current.get(threadId)?.id === stream?.id) cache.current.delete(threadId);
      setStream(undefined);
    }
  }, [committed, threadId, stream?.id]);
  // This chat's reply while it streams; once committed, the transcript shows it instead.
  const reply = stream?.thread === threadId && !committed ? stream?.text : undefined;
  useLayoutEffect(() => {
    if (reply) markPerformance(PerformanceMarkName.TextPaint);
  }, [reply]);
  const writing = reply && !isHandoffNarration(reply) ? reply : null;
  const showing = writing !== null;
  // Before paint, so the work above unfolds in the frame the reply appears.
  useLayoutEffect(() => onShowing?.(showing), [showing, onShowing]);
  useLayoutEffect(() => () => onShowing?.(false), [onShowing]);
  return writing ? <WritingReply text={writing} /> : null;
});
