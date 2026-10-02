import { plural } from "../../shared/skill-words.ts";
import { type Entry, EntryKind } from "../chat-entries.ts";
import type { ToolChipRow } from "../ui/ToolChips.tsx";
import { toolFailed, ToolState } from "../ui/tool-state.ts";
import { USING_A_TOOL } from "../words.ts";

/** What one line of a work group is: a tool row, an activity note or a thought. */
export const ActivityItemKind = {
  Tool: "tool",
  Note: "note",
  Thought: "thought",
} as const;
export type ActivityItemKind = (typeof ActivityItemKind)[keyof typeof ActivityItemKind];

/** The conversation's own row beside `Entry`'s kinds: neighbouring background work folded into one group. */
export const WORK_KIND = "work";

export type ActivityItem =
  | { kind: typeof ActivityItemKind.Tool; id: string; tool: ToolChipRow }
  | { kind: typeof ActivityItemKind.Note | typeof ActivityItemKind.Thought; id: string; text: string };
export type ConversationEntry =
  | Exclude<Entry, BackgroundEntry>
  | { kind: typeof WORK_KIND; id: string; items: ActivityItem[] };

/** The background work the transcript folds into one group: tool rows, activity notes and thinking. */
type BackgroundEntry = Extract<
  Entry,
  { kind: typeof EntryKind.Tools | typeof EntryKind.Activity | typeof EntryKind.Thinking }
>;
const BACKGROUND_KINDS: ReadonlySet<string> = new Set([EntryKind.Tools, EntryKind.Activity, EntryKind.Thinking]);
const isBackground = (entry: Entry): entry is BackgroundEntry => BACKGROUND_KINDS.has(entry.kind);

/** Group only neighboring background activity. Never move a reply, decision, failure or result. */
export function conversationEntries(entries: Entry[]): ConversationEntry[] {
  const result: ConversationEntry[] = [];
  for (const entry of entries) {
    if (!isBackground(entry)) {
      result.push(entry);
      continue;
    }
    let group = result.at(-1);
    if (group?.kind !== WORK_KIND) {
      group = { kind: WORK_KIND, id: entry.id, items: [] };
      result.push(group);
    }
    if (entry.kind === EntryKind.Tools)
      group.items.push(...entry.rows.map((tool) => ({ kind: ActivityItemKind.Tool, id: tool.key, tool })));
    else if (entry.kind === EntryKind.Thinking)
      group.items.push({ kind: ActivityItemKind.Thought, id: entry.id, text: entry.text });
    else
      group.items.push(
        ...entry.rows.map((row, i) => ({ kind: ActivityItemKind.Note, id: `${entry.id}:${i}`, text: row.text })),
      );
  }
  return result;
}

export function activitySummary(items: ActivityItem[]): string {
  const tools = items.flatMap((item) => (item.kind === ActivityItemKind.Tool ? [item.tool] : []));
  // Only a recorded running tool is active. Unknown historical outcomes must stay unknown.
  const running = tools.findLast((tool) => tool.state === ToolState.Running);
  if (running) return running.activeLabel ?? USING_A_TOOL;
  if (tools.length > 0) return `Worked on ${plural(tools.length, "step")}`;
  if (items.every((item) => item.kind === ActivityItemKind.Thought)) return "Thinking details";
  return "Work details";
}

/** A tool call in the work that failed. */
export const failedToolItem = (item: ActivityItem): boolean =>
  item.kind === ActivityItemKind.Tool && toolFailed(item.tool);
