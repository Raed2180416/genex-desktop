/**
 * Digests for the ledger. A row commits a verifiable digest of its evidence, never the evidence:
 * the sha256 of a stream, a transcript or a snapshot, and the hash of an instruction folder.
 * Ported from genex-demo's `evals/harness/ledger/hash.ts` with the same semantics: `hashDir`
 * hashes every file's POSIX-relative path with its content (a rename is a different tree), skips
 * empty folders, sockets and devices, and hashes a link as its target text without following it
 * (a repointed link changes the digest; a cycle cannot hang the walk).
 */
import { createHash } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";

/** The hex length of a short digest (`case.version`, `gradeId`): sha256[:12]. */
export const SHORT_DIGEST_LENGTH = 12;

/** The sha256 of a UTF-8 text, as hex. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The sha256 of a file's bytes, as hex, streamed. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The first twelve hex characters of a digest. */
export function shortDigest(hex: string): string {
  return hex.slice(0, SHORT_DIGEST_LENGTH);
}

/** JSON with every object's keys sorted, so two equal values always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareText(a, b));
  return Object.fromEntries(entries.map(([key, inner]) => [key, sortKeys(inner)]));
}

/** Code-unit order, the same on every machine and locale. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Which paths `hashDir` leaves out. */
export interface HashDirOptions {
  /** True to leave a path out; it receives the POSIX-relative path. */
  readonly exclude?: (relativePath: string) => boolean;
}

/**
 * A deterministic sha256 over a folder: for every file, sorted by its POSIX-relative path,
 * `<relative path> \0 <sha256 of the file> \n`.
 */
export async function hashDir(directory: string, options: HashDirOptions = {}): Promise<string> {
  const hash = createHash("sha256");
  for (const [relativePath, digest] of await hashDirEntries(directory, options))
    hash.update(`${relativePath}\0${digest}\n`, "utf8");
  return hash.digest("hex");
}

/** The per-file digests behind `hashDir`, sorted, for diagnosing a mismatch. */
export async function hashDirEntries(
  directory: string,
  options: HashDirOptions = {},
): Promise<readonly (readonly [string, string])[]> {
  const root = path.resolve(directory);
  if (!(await stat(root)).isDirectory()) throw new TypeError(`hashDir: ${root} is not a directory`);
  const found: [string, string][] = [];
  await walk(root, root, options, found);
  return found.sort(([a], [b]) => compareText(a, b));
}

async function walk(root: string, current: string, options: HashDirOptions, found: [string, string][]): Promise<void> {
  for (const dirent of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, dirent.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (options.exclude?.(relative)) continue;
    if (dirent.isDirectory()) await walk(root, absolute, options, found);
    else {
      const digest = await entryDigest(dirent, absolute);
      if (digest) found.push([relative, digest]);
    }
  }
}

/** A file's content digest, a link's target-text digest, or null for what has no stable content. */
async function entryDigest(dirent: Dirent, absolute: string): Promise<string | null> {
  if (dirent.isSymbolicLink()) return sha256Text(`symlink:${await readlink(absolute)}`);
  if (dirent.isFile()) return sha256File(absolute);
  return null;
}
