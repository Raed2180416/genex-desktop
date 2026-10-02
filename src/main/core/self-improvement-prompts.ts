/**
 * What the idle-time architect (`self-improvement.ts` runArchitectJob) is told: the model-facing
 * text of its two calls, picking one harness file and rewriting it.
 */
import type { CompleteRequest } from "../../substrate/engines/types.ts";

/** How much of the lesson buffer the pick call shows, in characters. */
const LESSON_BUFFER_MAX_CHARS = 4_000;

const PICK_SYSTEM_PROMPT = [
  "You are the studio's architect. You may propose ONE structural improvement to the studio's own",
  "harness code or prompts — the files listed. judge/ is frozen and absent from the list on purpose.",
  'Reply with JSON only: {"file":"<one path from the list>","why":"…"} or {"file":null} if nothing is worth changing.',
].join("\n");

const REWRITE_SYSTEM_PROMPT = [
  "You are the studio's architect, rewriting ONE of the studio's own files. Keep the module's",
  "contract (exports, tool shapes) — a file that fails to load is rewound by the watchdog.",
  "Reply with exactly: a line `REASON: <one sentence>`, then the complete new file inside one",
  "```file fenced block. No other prose.",
].join("\n");

/** The pick call: the files the architect may change, and the recent lessons. */
export function architectPickPrompt(
  files: readonly string[],
  lessons: readonly unknown[],
): Pick<CompleteRequest, "systemPrompt" | "messages"> {
  return {
    systemPrompt: PICK_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          "FILES:",
          ...files.map((f) => `- ${f}`),
          "",
          "RECENT LESSON BUFFER (rejected/accepted improvement notes):",
          JSON.stringify(lessons).slice(0, LESSON_BUFFER_MAX_CHARS),
        ].join("\n"),
      },
    ],
  };
}

/** The rewrite call: the one file the pick named, whole, and why. */
export function architectRewritePrompt(
  relative: string,
  why: string | undefined,
  original: string,
): Pick<CompleteRequest, "systemPrompt" | "messages"> {
  return {
    systemPrompt: REWRITE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `FILE ${relative} (why: ${why ?? "no reason given"}):\n\n\`\`\`\n${original}\n\`\`\``,
      },
    ],
  };
}
