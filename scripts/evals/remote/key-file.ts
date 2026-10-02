/**
 * The `evals_ingest` key file (§20.1, M5.2): the one credential `ledger publish` may read. It lives
 * at `$GENEX_EVALS_KEY_FILE`, by default `$GENEX_EVALS_HOME/secrets/genex-evals.key`, and is
 * refused when it sits inside a Git worktree (where it could be committed), when group or others
 * may read it (anything but `0600`/`0400`), or when its content is not a `genex_sk_v1_…` key. The
 * value never reaches a log: errors carry a code and the path only, and the key object prints as
 * `[redacted]` however it is formatted. Nothing here reads any other Genex credential.
 */
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import { REDACTED, redactSecrets } from "../../../src/shared/redact.ts";
import { EVALS_HOME_ENV } from "../home.ts";
import { EVALS_INGEST_KEY_PREFIX, EVALS_KEY_FILE_ENV } from "./contract.ts";

/** Where the key file sits under the eval home when `GENEX_EVALS_KEY_FILE` is unset. */
export const DEFAULT_KEY_FILE_SEGMENTS = ["secrets", "genex-evals.key"] as const;
/** The largest key file read; a key is well under this, anything bigger is not one. */
export const KEY_FILE_MAX_BYTES = 512;
/** An ingest key: the prefix and a base64url body (43 characters when minted), as `redact.ts` recognizes it. */
export const INGEST_KEY_PATTERN = new RegExp(`^${EVALS_INGEST_KEY_PREFIX}[A-Za-z0-9_-]{16,256}$`);
/** Permission bits for group and others; any of them set means the file is too open. */
const GROUP_OR_OTHER_BITS = 0o077;

/** Why a key file was refused. */
export const KeyFileRefusal = {
  NotConfigured: "not-configured",
  NotAbsolute: "not-absolute",
  Missing: "missing",
  NotAFile: "not-a-file",
  InsideGitWorktree: "inside-git-worktree",
  TooOpen: "too-open",
  TooLarge: "too-large",
  BadShape: "bad-shape",
} as const;
export type KeyFileRefusal = (typeof KeyFileRefusal)[keyof typeof KeyFileRefusal];

const MESSAGE: Record<KeyFileRefusal, string> = {
  [KeyFileRefusal.NotConfigured]: `set ${EVALS_KEY_FILE_ENV} or ${EVALS_HOME_ENV} to locate the ingest key`,
  [KeyFileRefusal.NotAbsolute]: "the key file path must be absolute",
  [KeyFileRefusal.Missing]: "the key file does not exist",
  [KeyFileRefusal.NotAFile]: "the key file is not a regular file",
  [KeyFileRefusal.InsideGitWorktree]: "the key file is inside a Git worktree; move it outside any checkout",
  [KeyFileRefusal.TooOpen]: "the key file is readable by group or others; chmod 600 it",
  [KeyFileRefusal.TooLarge]: "the key file is too large to be an ingest key",
  [KeyFileRefusal.BadShape]: `the key file does not hold one ${EVALS_INGEST_KEY_PREFIX}… key`,
};

/** A refused key file: a code and the path, never the content. */
export class KeyFileError extends Error {
  readonly code: KeyFileRefusal;
  constructor(code: KeyFileRefusal, file: string | null) {
    super(redactSecrets(`${code}: ${MESSAGE[code]}${file ? ` (${file})` : ""}`));
    this.name = "KeyFileError";
    this.code = code;
  }
}

/** The ingest key, held so it prints as `[redacted]` in a template, JSON or `console.log`. */
export interface IngestKey {
  /** The `Authorization` header value: `Bearer <key>`. */
  bearer(): string;
  toString(): string;
  toJSON(): string;
}

/** The file system calls the key reader makes; tests pass spies. */
export interface KeyFileFs {
  lstat: (file: string) => Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  stat: (file: string) => Promise<{ isFile(): boolean; mode: number; size: number }>;
  realpath: (file: string) => Promise<string>;
  readFile: (file: string) => Promise<Buffer>;
}

const NODE_FS: KeyFileFs = { lstat, stat, realpath, readFile: (file) => readFile(file) };

/** The key file's path from the environment, or a `not-configured`/`not-absolute` refusal. */
export function keyFilePath(env: Readonly<Record<string, string | undefined>>): string {
  const named = env[EVALS_KEY_FILE_ENV];
  if (named) return absolute(named);
  const home = env[EVALS_HOME_ENV];
  if (home) return path.join(absolute(home), ...DEFAULT_KEY_FILE_SEGMENTS);
  throw new KeyFileError(KeyFileRefusal.NotConfigured, null);
}

function absolute(file: string): string {
  if (!path.isAbsolute(file)) throw new KeyFileError(KeyFileRefusal.NotAbsolute, file);
  return path.resolve(file);
}

/** Read and check the ingest key named by the environment; throws `KeyFileError` on any refusal. */
export async function readIngestKey(
  env: Readonly<Record<string, string | undefined>>,
  fs: KeyFileFs = NODE_FS,
): Promise<IngestKey> {
  const file = keyFilePath(env);
  const real = await fs.realpath(file).catch(() => {
    throw new KeyFileError(KeyFileRefusal.Missing, file);
  });
  const inGit = await Promise.all([insideGitWorktree(file, fs), insideGitWorktree(real, fs)]);
  if (inGit.some(Boolean)) throw new KeyFileError(KeyFileRefusal.InsideGitWorktree, file);
  const info = await fs.stat(real);
  if (!info.isFile()) throw new KeyFileError(KeyFileRefusal.NotAFile, file);
  if (info.mode & GROUP_OR_OTHER_BITS) throw new KeyFileError(KeyFileRefusal.TooOpen, file);
  if (info.size > KEY_FILE_MAX_BYTES) throw new KeyFileError(KeyFileRefusal.TooLarge, file);
  const value = (await fs.readFile(real)).toString("utf8").replace(/\r?\n$/, "");
  if (!INGEST_KEY_PATTERN.test(value)) throw new KeyFileError(KeyFileRefusal.BadShape, file);
  return ingestKey(value);
}

/** Whether `file` or any folder above it holds a `.git` entry (a checkout or a linked worktree). */
export async function insideGitWorktree(file: string, fs: Pick<KeyFileFs, "lstat"> = NODE_FS): Promise<boolean> {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    const found = await fs.lstat(path.join(dir, ".git")).then(
      () => true,
      () => false,
    );
    if (found) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function ingestKey(value: string): IngestKey {
  const hidden = () => REDACTED;
  return Object.freeze({
    bearer: () => `Bearer ${value}`,
    toString: hidden,
    toJSON: hidden,
    [inspect.custom]: hidden,
  });
}
