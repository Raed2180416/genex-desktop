/**
 * Follow up in chat, from a node on the Builds graph: the composer names what the reply is about,
 * per chat, until it is sent or the chip is dismissed (`reply-about.ts`).
 */
import { useCallback, useEffect, useState } from "react";
import { REPLY_ABOUT_EVENT, type ReplyAbout } from "../reply-about.ts";

export interface ReplyingAbout {
  /** What the open chat's next message is a note about, or null. */
  about: ReplyAbout | null;
  /** Stop replying about it in this chat. */
  drop: (threadId: string) => void;
}

export function useReplyAbout(threadId: string | undefined, focusComposer: () => void): ReplyingAbout {
  const [aboutByThread, setAboutByThread] = useState<Record<string, ReplyAbout>>({});
  const drop = useCallback(
    (id: string): void =>
      setAboutByThread((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      }),
    [],
  );
  useEffect(() => {
    const reply = (event: Event): void => {
      const about = (event as CustomEvent<ReplyAbout>).detail;
      if (!about?.threadId) return;
      setAboutByThread((current) => ({ ...current, [about.threadId]: about }));
      requestAnimationFrame(focusComposer);
    };
    window.addEventListener(REPLY_ABOUT_EVENT, reply);
    return () => window.removeEventListener(REPLY_ABOUT_EVENT, reply);
  }, [focusComposer]);
  return { about: (threadId && aboutByThread[threadId]) || null, drop };
}
