/**
 * A tool permission request as the chat keeps it, and the person's answer as the UI sends it: pure
 * helpers for `chat-permissions.ts`. The card is built from Claude Code's own words, bounded and
 * without terminal codes; the answer is checked field by field, since the renderer is a browser.
 */
import {
  isSteadyPermissionMode,
  PermissionDecision,
  PLAN_TOOL,
  type ToolPermissionAnswer,
  type ToolPermissionEvent,
} from "../../shared/permissions.ts";
import type { PermissionAsk } from "../../substrate/engines/types.ts";

/** A card keeps this much of each string in the tool's input, and this much of a plan. */
const PERMISSION_TEXT_MAX = 2000;
const PERMISSION_PLAN_MAX = 32_000;
const TITLE_MAX = 500;
const NAME_MAX = 200;
/** A deny's own words are at most this long. */
const ANSWER_MESSAGE_MAX = 4000;
/** How deep, how many items and how many keys of a tool's input the record keeps. */
const DIGEST_DEPTH = 3;
const DIGEST_ITEMS = 20;
const DIGEST_KEYS = 50;
/** What stands for what the digest left out. */
const ELIDED = "…";
/** File tools whose one subject is the path they touch. */
const FILE_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Read"]);
/** Which input fields name the one thing a tool's card asks about, by tool. */
const SUBJECT_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["Bash", ["command"]],
  ["Glob", ["path", "pattern"]],
  ["Grep", ["path", "pattern"]],
  ["WebFetch", ["url"]],
  ["SandboxNetworkAccess", ["host"]],
]);
const FILE_FIELDS = ["file_path", "notebook_path"];
/** Terminal colour codes Claude Code may leave in its words. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point: they are removed.
const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}${ELIDED}` : text;
}

/** Claude Code's words for a card: plain text without terminal escapes, trimmed and bounded. */
function cardWords(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(ANSI_CSI, "").trim();
  return text ? clipText(text, max) : undefined;
}

/** An array as the record keeps it: the first items, then how many were left out. */
function digestList(value: unknown[], depth: number): unknown[] {
  const items = value.slice(0, DIGEST_ITEMS).map((item) => inputDigest(item, depth + 1) ?? null);
  return value.length > DIGEST_ITEMS ? [...items, `${ELIDED} ${value.length - DIGEST_ITEMS} more`] : items;
}

/**
 * The tool's input as the thread keeps it: long strings clipped, long lists cut, deep objects
 * elided. Claude still runs the call with its input in full: this is only the record.
 */
export function inputDigest(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return clipText(value, PERMISSION_TEXT_MAX);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;
  if (depth >= DIGEST_DEPTH) return ELIDED;
  if (Array.isArray(value)) return digestList(value, depth);
  const entries = Object.entries(value)
    .slice(0, DIGEST_KEYS)
    .map(([key, item]) => [key, inputDigest(item, depth + 1)] as const)
    .filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries);
}

/** The one thing a card asks about: the command, the file, the URL or the host. */
export function requestSubject(tool: string, input: Record<string, unknown>): string | undefined {
  const fields = FILE_TOOLS.has(tool) ? FILE_FIELDS : (SUBJECT_FIELDS.get(tool) ?? []);
  const subject = fields
    .map((key) => input[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  return subject === undefined ? undefined : clipText(subject, PERMISSION_TEXT_MAX);
}

/** The words of the card, without the ones Claude Code left out. */
function requestWords(ask: PermissionAsk, input: Record<string, unknown>): Partial<ToolPermissionEvent> {
  const words = {
    title: cardWords(ask.title, TITLE_MAX),
    displayName: cardWords(ask.displayName, NAME_MAX),
    description: cardWords(ask.description, PERMISSION_TEXT_MAX),
    reason: cardWords(ask.reason, PERMISSION_TEXT_MAX),
    blockedPath: cardWords(ask.blockedPath, PERMISSION_TEXT_MAX),
    agentId: cardWords(ask.agentId, NAME_MAX),
    subject: requestSubject(ask.tool, input),
  };
  return Object.fromEntries(Object.entries(words).filter(([, value]) => value !== undefined));
}

/**
 * The question as the chat keeps it, before its state: Claude Code's words, the bounded input,
 * the plan to approve (kept once, not also in the input), and what "always" would grant.
 */
export function permissionRequest(
  where: { requestId: string; project: string; threadId: string },
  ask: PermissionAsk,
): Omit<ToolPermissionEvent, "state"> {
  const input = ask.input && typeof ask.input === "object" ? ask.input : {};
  const planTool = ask.tool === PLAN_TOOL;
  const plan = planTool && typeof input.plan === "string" ? clipText(input.plan, PERMISSION_PLAN_MAX) : undefined;
  const recorded = planTool ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "plan")) : input;
  const always = Array.isArray(ask.always) && ask.always.length ? ask.always : undefined;
  return {
    ...where,
    tool: ask.tool,
    ...requestWords(ask, input),
    input: inputDigest(recorded) as Record<string, unknown>,
    ...(plan !== undefined ? { plan } : {}),
    ...(always ? { always } : {}),
  };
}

/** A deny's own words as the person typed them: trimmed, or none. */
function denyAnswer(message: unknown): ToolPermissionAnswer | null {
  if (message === undefined) return { decision: PermissionDecision.Deny };
  if (typeof message !== "string" || message.length > ANSWER_MESSAGE_MAX) return null;
  const words = message.trim();
  return words ? { decision: PermissionDecision.Deny, message: words } : { decision: PermissionDecision.Deny };
}

/** The person's answer as the UI sent it, checked field by field; null when it is not one. */
export function permissionAnswer(value: unknown): ToolPermissionAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { decision, mode, message } = value as { decision?: unknown; mode?: unknown; message?: unknown };
  if (decision === PermissionDecision.Allow || decision === PermissionDecision.Always) return { decision };
  if (decision === PermissionDecision.ApprovePlan) return isSteadyPermissionMode(mode) ? { decision, mode } : null;
  return decision === PermissionDecision.Deny ? denyAnswer(message) : null;
}
