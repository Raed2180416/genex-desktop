import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import type { DownloadFile } from "./manifest.ts";
import { setTimeout as delay } from "node:timers/promises";
import { SECOND_MS } from "../../shared/duration.ts";

/** What a download progress report says (`DownloadProgress.status`). */
export const DownloadStatus = {
  Downloading: "downloading",
  Verifying: "verifying",
  /** The file was already complete and matched its digest; nothing was fetched. */
  Verified: "verified",
  /** Reported by the installer once every file is in place. */
  Success: "success",
} as const;
export type DownloadStatus = (typeof DownloadStatus)[keyof typeof DownloadStatus];

export interface DownloadProgress {
  status: DownloadStatus;
  completed: number;
  total: number;
}

/** Free space kept beyond the bytes still to fetch. */
const DISK_RESERVE_BYTES = 256 * 1024 ** 2;
const STALL_TIMEOUT_MS = 60 * SECOND_MS;
const PROGRESS_INTERVAL_MS = 150;
const HTTP_PARTIAL_CONTENT = 206;
/**
 * The pauses before reconnecting after a lost connection, one per consecutive try that saved no new
 * bytes; a try that saved some starts the list again. About two minutes of outage before giving up.
 */
const RECONNECT_BACKOFFS_MS = [2 * SECOND_MS, 5 * SECOND_MS, 15 * SECOND_MS, 30 * SECOND_MS, 60 * SECOND_MS] as const;

/** Why a fetch lost its connection, as Node's fetch puts it on `error.cause.code`; never rename a value. */
const ConnectionLoss = {
  Socket: "UND_ERR_SOCKET",
  ConnectTimeout: "UND_ERR_CONNECT_TIMEOUT",
  HeadersTimeout: "UND_ERR_HEADERS_TIMEOUT",
  BodyTimeout: "UND_ERR_BODY_TIMEOUT",
  Reset: "ECONNRESET",
  Refused: "ECONNREFUSED",
  TimedOut: "ETIMEDOUT",
  BrokenPipe: "EPIPE",
  NetworkDown: "ENETDOWN",
  NetworkUnreachable: "ENETUNREACH",
  HostUnreachable: "EHOSTUNREACH",
  NameNotFound: "ENOTFOUND",
  NameLookupAgain: "EAI_AGAIN",
  /** Our own: the connection stayed open but sent nothing for {@link STALL_TIMEOUT_MS}. */
  Stalled: "STALLED",
} as const;
const CONNECTION_LOSSES: ReadonlySet<string> = new Set(Object.values(ConnectionLoss));

const MESSAGE = {
  NoSpace: "Not enough disk space for this model download",
  Stalled: "Download stalled for 60 seconds.",
  ConnectionLost:
    "Lost the connection to the download server. Check your internet connection and try again. Downloaded parts are kept.",
  HttpFailed: (status: number) => `Download failed: HTTP ${status}`,
  BadRange: "Invalid download resume range",
  TooLarge: "Download exceeds pinned file size",
  Integrity: (name: string) => `Integrity check failed: ${name}`,
} as const;

/** How {@link download} waits; tests shorten these. */
export interface DownloadTiming {
  /** The pause before a reconnect (default: a cancellable timer). */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How long a connection may stay silent before it counts as lost (default {@link STALL_TIMEOUT_MS}). */
  stallMs?: number;
}

/** Whether a fetch failed because its connection was lost (dropped, refused, unreachable or silent). */
function isConnectionLoss(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && CONNECTION_LOSSES.has(code);
}

export async function matches(file: string, spec: DownloadFile): Promise<boolean> {
  if ((await stat(file).catch(() => null))?.size !== spec.bytes) return false;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex") === spec.sha256;
}

/** How many bytes of `partial` can be resumed; an oversized partial is deleted and restarts at 0. */
async function resumableOffset(partial: string, spec: DownloadFile): Promise<number> {
  const offset = (await stat(partial).catch(() => null))?.size ?? 0;
  if (offset <= spec.bytes) return offset;
  await rm(partial);
  return 0;
}

/** A 206 answer must resume exactly where the partial file ends and name the pinned size. */
function isExpectedRange(range: string | null, offset: number, spec: DownloadFile): boolean {
  return Boolean(range?.startsWith(`bytes ${offset}-`) && range.endsWith(`/${spec.bytes}`));
}

/** An abort signal that fires, as a lost connection, when `touch` has not been called for `stallMs`. */
function stallWatch(stallMs: number) {
  const stalled = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => stalled.abort(new Error(MESSAGE.Stalled, { cause: { code: ConnectionLoss.Stalled } })),
      stallMs,
    );
    timer.unref();
  };
  touch();
  return { signal: stalled.signal, touch, stop: () => clearTimeout(timer) };
}

/**
 * Fetch the rest of `spec` into `partial`, starting at `start`. Returns the partial file's size;
 * a server that ignores the range restarts the file from 0.
 */
async function fetchInto(
  spec: DownloadFile,
  partial: string,
  start: number,
  signal: AbortSignal,
  progress: (p: DownloadProgress) => void,
  stallMs: number,
): Promise<number> {
  const watch = stallWatch(stallMs);
  const networkSignal = AbortSignal.any([signal, watch.signal]);
  try {
    const response = await fetch(spec.url, {
      signal: networkSignal,
      headers: start ? { Range: `bytes=${start}-` } : {},
    });
    if (!response.ok || !response.body) throw new Error(MESSAGE.HttpFailed(response.status));
    const resumed = response.status === HTTP_PARTIAL_CONTENT;
    if (resumed && !isExpectedRange(response.headers.get("content-range"), start, spec))
      throw new Error(MESSAGE.BadRange);
    let offset = resumed ? start : 0;
    const file = await open(partial, offset ? "a" : "w");
    let last = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body as never)) {
        networkSignal.throwIfAborted();
        watch.touch();
        offset += chunk.length;
        if (offset > spec.bytes) throw new Error(MESSAGE.TooLarge);
        await file.writeFile(chunk);
        if (Date.now() - last > PROGRESS_INTERVAL_MS) {
          progress({ status: DownloadStatus.Downloading, completed: offset, total: spec.bytes });
          last = Date.now();
        }
      }
    } finally {
      await file.close();
    }
    return offset;
  } finally {
    watch.stop();
  }
}

/**
 * Fetch the rest of `spec` into `partial`, reconnecting from the saved bytes when the connection is
 * lost. Gives up once every pause in {@link RECONNECT_BACKOFFS_MS} passed with no byte saved; the
 * partial stays for a later resume.
 */
async function fetchReconnecting(
  spec: DownloadFile,
  partial: string,
  signal: AbortSignal,
  progress: (p: DownloadProgress) => void,
  timing: DownloadTiming,
): Promise<number> {
  const wait = timing.wait ?? ((ms, cancel) => delay(ms, undefined, { signal: cancel }));
  let misses = 0;
  for (;;) {
    const start = await resumableOffset(partial, spec);
    try {
      return await fetchInto(spec, partial, start, signal, progress, timing.stallMs ?? STALL_TIMEOUT_MS);
    } catch (error) {
      signal.throwIfAborted();
      if (!isConnectionLoss(error)) throw error;
      if ((await resumableOffset(partial, spec)) > start) misses = 0;
      const pause = RECONNECT_BACKOFFS_MS[misses];
      if (pause === undefined) throw new Error(MESSAGE.ConnectionLost, { cause: error });
      misses++;
      await wait(pause, signal);
    }
  }
}

/** Resume a partial file, but only publish bytes after verifying the pinned digest. */
export async function download(
  spec: DownloadFile,
  directory: string,
  signal: AbortSignal,
  progress: (p: DownloadProgress) => void,
  timing: DownloadTiming = {},
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, spec.name);
  const partial = `${target}.part`;
  if (await matches(target, spec)) {
    progress({ status: DownloadStatus.Verified, completed: spec.bytes, total: spec.bytes });
    return target;
  }
  let offset = await resumableOffset(partial, spec);
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < spec.bytes - offset + DISK_RESERVE_BYTES) throw new Error(MESSAGE.NoSpace);
  if (offset < spec.bytes) offset = await fetchReconnecting(spec, partial, signal, progress, timing);
  signal.throwIfAborted();
  progress({ status: DownloadStatus.Verifying, completed: offset, total: spec.bytes });
  if (!(await matches(partial, spec))) {
    await rm(partial, { force: true });
    throw new Error(MESSAGE.Integrity(spec.name));
  }
  await rename(partial, target);
  return target;
}
