import { useState } from "react";
import { IconButton } from "../ui/kit.tsx";
import { UserMessage } from "../chat/UserMessage.tsx";
import { type Notify, notifyProblem } from "../state/toasts.ts";
import type { ReferenceFrame } from "../../shared/protocol.ts";
import { CHAT_WORDS } from "../words.ts";

/** Sent during work and not saved yet: it waits where it will be queued, and cannot be removed yet. */
export function SendingMessage({ text, frames }: { text: string; frames?: ReferenceFrame[] }) {
  return (
    <div data-sending-message className="flex min-w-0 flex-col items-end gap-0.5">
      <UserMessage text={text} pending frames={frames} />
      <div className="flex min-h-6 items-center text-xs text-ink-3">
        <span role="status">{CHAT_WORDS.sendingMessage}</span>
      </div>
    </div>
  );
}

/**
 * Waiting input sits below the current work until it is delivered; Remove withdraws it. One
 * handed to the running turn reads Sending… until that turn reads it, and can no longer be removed.
 * How it arrives and leaves is the conversation's (`Presence`).
 */
export function QueuedMessage({
  threadId,
  messageId,
  text,
  sending = false,
  images,
  onNotice,
}: {
  threadId: string;
  messageId: string;
  text: string;
  /** Handed to the running turn and not read yet: it can no longer be withdrawn. */
  sending?: boolean;
  /** Pictures sent with it: how many, when the log knows. */
  images?: { count?: number };
  onNotice: Notify;
}) {
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    setRemoving(true);
    try {
      await window.studio.changeQueuedMessage(threadId, messageId, "remove");
    } catch (error) {
      notifyProblem(onNotice)(error);
      setRemoving(false);
    }
  };
  return (
    <div data-queued-message={messageId} className="flex min-w-0 flex-col items-end gap-0.5">
      <UserMessage
        text={text}
        pending
        {...(images ? { threadId, imagesOf: messageId, imageCount: images.count } : {})}
      />
      {/* Remove's height either way, so nothing moves when a message the turn did not read waits as Queued. */}
      <div className="flex min-h-6 items-center gap-0.5 text-xs text-ink-3">
        <span role="status">{sending ? CHAT_WORDS.sendingMessage : CHAT_WORDS.queued}</span>
        {!sending && (
          <IconButton
            icon="trash"
            label="Remove queued message"
            size={12}
            className="chat-queued-remove"
            disabled={removing}
            onClick={() => void remove()}
          />
        )}
      </div>
    </div>
  );
}
