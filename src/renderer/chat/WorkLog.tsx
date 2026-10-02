import { memo, useState } from "react";
import { ActivityItemKind, activitySummary, failedToolItem, type ActivityItem } from "./conversation-entries.ts";
import { ToolRow } from "../ui/ToolChips.tsx";
import { FileText } from "../ui/FileText.tsx";
import { ChatDisclosure } from "./ChatDisclosure.tsx";

/** One quiet entry point for the chronological work behind a reply. */
export const WorkLog = memo(function WorkLog({ items }: { items: ActivityItem[] }) {
  const [open, setOpen] = useState(false);
  const failures = items.filter(failedToolItem).length;
  return (
    <ChatDisclosure
      data-work-log
      label={activitySummary(items)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      frame={false}
      suffix={failures > 0 ? <span className="shrink-0 text-orange">· {failures} failed</span> : undefined}
    >
      <WorkLogContent items={items} />
    </ChatDisclosure>
  );
});

export function WorkLogContent({ items }: { items: ActivityItem[] }) {
  const [limit, setLimit] = useState(30);
  return (
    <div data-work-log-items className="chat-tool-frame">
      {items.length > limit && (
        <button type="button" onClick={() => setLimit((value) => value + 30)} className="chat-disclosure mx-1">
          Show {Math.min(30, items.length - limit)} earlier steps
        </button>
      )}
      {items.slice(-limit).map((item) =>
        item.kind === ActivityItemKind.Tool ? (
          <ToolRow key={item.id} row={item.tool} />
        ) : (
          <p key={item.id} className="px-3 py-2 text-step whitespace-pre-wrap text-ink-3 [overflow-wrap:anywhere]">
            <FileText text={item.text} />
          </p>
        ),
      )}
    </div>
  );
}
