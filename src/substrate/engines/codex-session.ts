import path from "node:path";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { ContextSource } from "../../shared/context.ts";
import { DAY_MS } from "../../shared/duration.ts";

export interface CodexSessionMetadata {
  model?: string;
  cliVersion?: string;
  lastCompaction?: { id: string; at: string };
  /** Every compaction in the part of the file read, oldest first; absent when there is none. */
  compactions?: Array<{ id: string; at: string }>;
  context?: {
    promptTokens?: number;
    contextWindow?: number;
    source: typeof ContextSource.ProviderSession;
    compacted?: boolean;
    measuredAt?: string;
    lastCompactedAt?: string;
  };
}

/** A Codex session id: a UUID, and nothing else ever names a session file. */
const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** The session file's first line (its `session_meta`) fits in this. */
const HEAD_BYTES = 65_536;
/** How much of the file's end is read for the latest model, context and compaction. */
const TAIL_BYTES = 8_000_000;

/** The session-file row types this reads. Vendor wire values. */
const SessionRow = {
  Meta: "session_meta",
  TurnContext: "turn_context",
  Compacted: "compacted",
  EventMsg: "event_msg",
} as const;
/** The `event_msg` payload that carries a token count. */
const TOKEN_COUNT = "token_count";

/** Only the specific session's metadata, never another conversation's contents. */
export async function codexSessionMetadata(home: string, id: string, startedAt: number): Promise<CodexSessionMetadata> {
  if (!SESSION_ID.test(id)) return {};
  for (const time of candidateTimes(id, startedAt)) {
    if (!Number.isFinite(time)) continue;
    const found = await metadataOnDay(home, id, time);
    if (found) return found;
  }
  return {};
}

/** The session's metadata from the day folder `time` falls in; null when it is not filed there. */
async function metadataOnDay(home: string, id: string, time: number): Promise<CodexSessionMetadata | null> {
  const day = new Date(time).toISOString().slice(0, 10).replaceAll("-", path.sep);
  const dir = path.join(home, "sessions", day);
  const names = await readdir(dir).catch(() => []);
  for (const name of names.filter((n) => n.endsWith(`-${id}.jsonl`))) {
    const file = await open(path.join(dir, name), "r").catch(() => null);
    if (!file) continue;
    try {
      const metadata = await readSessionFile(file, id);
      if (metadata) return metadata;
    } catch {
      // A file this session's name matches but cannot be read ends the search empty-handed.
      return {};
    } finally {
      await file.close();
    }
  }
  return null;
}

/**
 * The days the session's file may be filed under: around this turn's start, now, and — for a
 * UUIDv7 id, which encodes its creation date — the day the session began, since a resumed
 * session may be older than this turn.
 */
function candidateTimes(id: string, startedAt: number): Set<number> {
  const dates = new Set([startedAt, Date.now()]);
  if (id[14] === "7") dates.add(parseInt(id.replaceAll("-", "").slice(0, 12), 16));
  return new Set([...dates].flatMap((time) => [time - DAY_MS, time, time + DAY_MS]));
}

/** The metadata of `file` when it is this session's; null when its first line names another. */
async function readSessionFile(file: FileHandle, id: string): Promise<CodexSessionMetadata | null> {
  const size = (await file.stat()).size;
  const head = Buffer.alloc(Math.min(size, HEAD_BYTES));
  await file.read(head, 0, head.length, 0);
  const meta = JSON.parse(head.toString("utf8").split("\n")[0] ?? "");
  if (meta.type !== SessionRow.Meta || meta.payload?.id !== id) return null;
  const result: CodexSessionMetadata = {};
  if (typeof meta.payload.cli_version === "string") result.cliVersion = meta.payload.cli_version;
  const start = Math.max(0, size - TAIL_BYTES);
  const tail = Buffer.alloc(size - start);
  await file.read(tail, 0, tail.length, start);
  let offset = start;
  for (const line of tail.toString("utf8").split("\n")) {
    const lineOffset = offset;
    offset += Buffer.byteLength(line) + 1;
    try {
      readRow(JSON.parse(line), `${id}:${lineOffset}`, result);
    } catch {}
  }
  if (result.context && result.lastCompaction) result.context.lastCompactedAt = result.lastCompaction.at;
  return result;
}

/** One row of the session file, folded into what is known: the model, a compaction, a token count. */
function readRow(row: SessionFileRow, compactionId: string, result: CodexSessionMetadata): void {
  if (row.type === SessionRow.TurnContext && typeof row.payload?.model === "string") result.model = row.payload.model;
  if (row.type === SessionRow.Compacted) {
    if (typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp))) {
      result.lastCompaction = { id: compactionId, at: row.timestamp };
      (result.compactions ??= []).push(result.lastCompaction);
    }
    result.context = { source: ContextSource.ProviderSession, compacted: true, measuredAt: row.timestamp };
  }
  if (row.type === SessionRow.EventMsg && row.payload?.type === TOKEN_COUNT) readTokenCount(row, result);
}

/** A token count: the prompt's size, and the window when the CLI reports it. */
function readTokenCount(row: SessionFileRow, result: CodexSessionMetadata): void {
  const info = row.payload?.info;
  const usage = info?.last_token_usage;
  if (typeof usage?.input_tokens !== "number") return;
  result.context = {
    source: ContextSource.ProviderSession,
    promptTokens: usage.input_tokens,
    ...(typeof info?.model_context_window === "number" ? { contextWindow: info.model_context_window } : {}),
    measuredAt: row.timestamp,
  };
}

/** A session-file row, the fields this reads. */
interface SessionFileRow {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: unknown;
    info?: { last_token_usage?: { input_tokens?: unknown }; model_context_window?: unknown };
  };
}
