import { memo, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReferenceFrame } from "../../shared/protocol.ts";
import { FileText } from "../ui/FileText.tsx";
import { Icon } from "../ui/icons.tsx";
import { IconButton } from "../ui/kit.tsx";
import { MessageImages } from "./MessageImages.tsx";

/** The words of a sent message, folded to seven lines with Show more once they run longer. */
function UserBubble({ text, pending }: { text: string; pending: boolean }) {
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 7 + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [text]);
  return (
    <div
      data-user-message
      className={`rounded-[16px] bg-field px-3 py-2 text-chat [overflow-wrap:anywhere] ${pending ? "text-ink-3" : ""}`}
    >
      {/* A file link reached by keyboard in the folded part unfolds the message, so it is seen. */}
      <div
        className="chat-user-content"
        data-collapsed={!expanded || undefined}
        data-overflow={overflow || undefined}
        onFocus={(event) => {
          if (overflow && !expanded && (event.target as Element).matches("[data-file-open]:focus-visible"))
            setExpanded(true);
        }}
      >
        <div id={id} ref={content} className="whitespace-pre-wrap">
          <FileText text={text} />
        </div>
      </div>
      {overflow && (
        <button
          type="button"
          className="chat-user-toggle"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => {
            if (expanded) content.current?.parentElement?.parentElement?.scrollIntoView({ block: "nearest" });
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * Keep long briefs readable without letting them take over the conversation. A delivered
 * message the chat can go back to carries Rewind beside the bubble (`onRewind` is called with
 * `rewindId`); it shows while the row is hovered or holds focus. A note sent to the build from
 * its graph names what it was `about` above the words.
 */
export const UserMessage = memo(function UserMessage({
  text,
  pending = false,
  threadId,
  imagesOf,
  imageCount,
  frames,
  rewindId,
  onRewind,
  about,
}: {
  text: string;
  pending?: boolean;
  threadId?: string;
  imagesOf?: string;
  imageCount?: number;
  frames?: ReferenceFrame[];
  rewindId?: string;
  onRewind?: (id: string) => void;
  about?: string;
}) {
  const rewind = rewindId && onRewind ? rewindId : null;
  // Rewind sits beside the bubble, outside it: it takes no height, and the bubble's own button
  // stays its toggle. The wrapper is always there, so the action coming and going between
  // answers never rebuilds the bubble (a selection or focus in it survives). Its 24px centres on
  // the bubble's last 22px line: 8px padding, less the 1px it overhangs that line each side.
  const placed = (
    <div className="relative ms-auto w-fit max-w-[88%]">
      <UserBubble text={text} pending={pending} />
      {rewind && onRewind && (
        <IconButton
          icon="rewind"
          label="Rewind to before this message"
          size={14}
          className="chat-user-action absolute right-full bottom-[7px] me-1"
          onClick={() => onRewind(rewind)}
        />
      )}
    </div>
  );
  if (about)
    return (
      <div data-user-note className="flex min-w-0 flex-col items-end gap-1">
        <span className="flex max-w-[88%] items-center gap-1.5 text-body-sm text-ink-3">
          <Icon name="chat" size={12} />
          <span className="truncate">{about}</span>
        </span>
        {placed}
      </div>
    );
  const hasFrames = Boolean(frames?.length);
  if (!hasFrames && (!threadId || !imagesOf)) return placed;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <MessageImages
        threadId={threadId}
        messageId={imagesOf}
        count={imageCount}
        frames={hasFrames ? frames : undefined}
      />
      {placed}
    </div>
  );
});
