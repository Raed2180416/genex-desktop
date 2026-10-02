/**
 * Render one checklist item into its prompt and read one vote back (§8.4). The judge never reads the
 * agent's own words: the prompt holds the brief, the item and the witnessed evidence only. Parsing is
 * strict about the verdict line and typed about failure: an answer that does not say exactly one of
 * `VERDICT: YES` / `VERDICT: NO` is `invalid`, never a silent `no`.
 */
import { createHash } from "node:crypto";
import type { AcceptanceItem } from "../../case-types.ts";
import { ChecklistVote } from "../../vocabulary.ts";
import { CHECKLIST_PROMPT_FILLER, CHECKLIST_PROMPT_TEMPLATE } from "./checklist-prompts.ts";

/** sha256 of the template and its fillers: the `graderPromptSha` pin, independent of any evidence. */
export const CHECKLIST_PROMPT_SHA = createHash("sha256")
  .update(CHECKLIST_PROMPT_TEMPLATE)
  .update(JSON.stringify(CHECKLIST_PROMPT_FILLER))
  .digest("hex");

/** One `{{name}}` placeholder. */
const PLACEHOLDER = /\{\{(\w+)\}\}/g;
/** A verdict line, whole: `VERDICT: YES` or `VERDICT: NO`, with nothing else on it but punctuation. */
const VERDICT_LINE = /^\s*\**VERDICT\**\s*:\**\s*\**(YES|NO)\**[.!]?\s*$/gim;

/** What an item prompt is built from. */
export interface ChecklistPromptInput {
  brief: string;
  item: AcceptanceItem;
  consoleSummary: string;
  networkSummary: string;
  frameCount: number;
}

/** The prompt for one item: the template with its placeholders filled in one pass. */
export function renderChecklistPrompt(input: ChecklistPromptInput): string {
  const values: Record<string, string> = {
    brief: input.brief,
    item: input.item.text,
    tracesTo: input.item.tracesTo ?? CHECKLIST_PROMPT_FILLER.NoTrace,
    frameCount: String(input.frameCount),
    console: input.consoleSummary || CHECKLIST_PROMPT_FILLER.EmptyConsole,
    network: input.networkSummary || CHECKLIST_PROMPT_FILLER.EmptyNetwork,
  };
  return CHECKLIST_PROMPT_TEMPLATE.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}

/** One reply read as a vote: exactly one verdict line decides; none, or both answers, is invalid. */
export function parseChecklistVote(reply: string): ChecklistVote {
  const answers = new Set([...reply.matchAll(VERDICT_LINE)].map((match) => (match[1] ?? "").toUpperCase()));
  if (answers.size !== 1) return ChecklistVote.Invalid;
  return answers.has("YES") ? ChecklistVote.Yes : ChecklistVote.No;
}
