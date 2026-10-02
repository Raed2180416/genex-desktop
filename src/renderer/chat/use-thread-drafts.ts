/**
 * What each chat keeps while the user moves between chats: the text typed but not sent, and
 * whether a send from it is still in flight. Both are per thread, so switching chats never
 * carries one chat's draft or busy line into another.
 */
import { useState } from "react";

export interface ThreadDrafts {
  /** A send from the open chat is in flight. */
  busy: boolean;
  /** The open chat's unsent text. */
  draft: string;
  /** Replace the open chat's unsent text. */
  setDraft(text: string): void;
  /** Mark a chat's send as started or settled. */
  setSending(threadId: string, sending: boolean): void;
  /** Empty a chat's unsent text (its send took it). */
  clearDraft(threadId: string): void;
  /** Words that come back to a chat's composer (a rewound message), before any draft already there. */
  putBack(threadId: string, text: string): void;
}

/** A draft with words put back in front of it; a draft that already says them is replaced. */
function withPutBack(draft: string | undefined, text: string): string {
  const kept = draft?.trim() ?? "";
  return kept && kept !== text.trim() ? `${text}\n\n${kept}` : text;
}

/** The open chat's draft and in-flight send, kept per thread. */
export function useThreadDrafts(threadId: string | undefined): ThreadDrafts {
  const [pendingByThread, setPendingByThread] = useState<Record<string, boolean>>({});
  const [draftByThread, setDraftByThread] = useState<Record<string, string>>({});
  const setFor = (id: string, text: string): void => setDraftByThread((current) => ({ ...current, [id]: text }));
  return {
    busy: Boolean(threadId && pendingByThread[threadId]),
    draft: (threadId && draftByThread[threadId]) || "",
    setDraft: (text) => {
      if (threadId) setFor(threadId, text);
    },
    setSending: (id, sending) => setPendingByThread((current) => ({ ...current, [id]: sending })),
    clearDraft: (id) => setFor(id, ""),
    putBack: (id, text) => setDraftByThread((current) => ({ ...current, [id]: withPutBack(current[id], text) })),
  };
}
