/**
 * What `ledger share` and `ledger unshare` keep on this machine (§20.3), under
 * `$GENEX_EVALS_HOME/secrets/` (owner-only, refused inside a Git worktree):
 *
 * - `install.json`: the eval CLI's install identity and every identity it retired. The current one
 *   rotates every 90 days; a retired one is kept for as long as the server keeps rows (180 days),
 *   so `ledger unshare` can still prove and delete what it sent. A file that exists but does not
 *   parse is refused, never minted over: re-minting would lose the only proof a delete has.
 * - `shared.jsonl`: one line per contribution the server accepted (install id, campaign, run id,
 *   grade sequence, when), so a re-run skips what was already shared under any identity.
 */
import { randomBytes } from "node:crypto";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DAY_MS } from "../../../src/shared/duration.ts";
import { INSTALL_ID_PATTERN, INSTALL_ID_ROTATION_MS } from "../../../src/shared/run-sharing.ts";
import { atomicWriteText } from "../../../src/substrate/fsx.ts";
import { CAMPAIGN_ID_PATTERN, INSTANT_PATTERN, RUN_ID_PATTERN, type RunRow } from "../ledger/types.ts";
import { EVIDENCE_RETENTION_DAYS, INSTALL_SECRET_PATTERN } from "./contract.ts";
import { insideGitWorktree } from "./key-file.ts";

/** Where the eval CLI's install identities live under the eval home. */
export const INSTALL_IDENTITY_SEGMENTS = ["secrets", "install.json"] as const;
/** Where the record of accepted contributions lives under the eval home. */
export const SHARED_RECORD_SEGMENTS = ["secrets", "shared.jsonl"] as const;
/** How long a retired identity is kept: as long as the server keeps the rows it proves. */
export const RETIRED_ID_KEEP_MS = EVIDENCE_RETENTION_DAYS * DAY_MS;
const INSTALL_ID_BYTES = 16;
const PRIVATE_FILE = 0o600;
const PRIVATE_DIR = 0o700;

/** Why a local share file was refused. */
export const ShareRecordRefusal = {
  InsideGitWorktree: "inside-git-worktree",
  /** `install.json` exists but is not a well-formed identity file. */
  Identity: "identity",
  /** A line of `shared.jsonl` is not a well-formed entry. */
  Record: "record",
} as const;
export type ShareRecordRefusal = (typeof ShareRecordRefusal)[keyof typeof ShareRecordRefusal];

/** A refused local share file: a code, never the file's content. */
export class ShareRecordError extends Error {
  readonly code: ShareRecordRefusal;
  constructor(code: ShareRecordRefusal) {
    super(`share record refused: ${code}`);
    this.name = "ShareRecordError";
    this.code = code;
  }
}

/** A random install id and the device-held secret that proves it for a delete. */
export interface InstallIdentity {
  installId: string;
  secret: string;
}

/** An identity the CLI no longer sends with, kept so its rows can still be deleted. */
export interface RetiredIdentity extends InstallIdentity {
  retiredAt: string;
}

/** Every identity this machine's eval CLI has used and still keeps. */
export interface InstallIdentities {
  current: InstallIdentity & { createdAt: string };
  retired: RetiredIdentity[];
}

/** One contribution the server accepted. */
export interface SharedEntry {
  installId: string;
  campaignId: string;
  runId: string;
  gradeSeq: number;
  contributedAt: string;
}

/** The key a shared row is skipped by: the same grade of the same run, under any identity. */
export function sharedKey(row: Pick<RunRow, "runId" | "gradeSeq">): string {
  return `${row.runId}#${row.gradeSeq}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIdentity = (value: Record<string, unknown>): boolean =>
  typeof value.installId === "string" &&
  INSTALL_ID_PATTERN.test(value.installId) &&
  typeof value.secret === "string" &&
  INSTALL_SECRET_PATTERN.test(value.secret);

const isInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function isRetired(value: unknown): value is RetiredIdentity {
  return isRecord(value) && isIdentity(value) && isInstant(value.retiredAt);
}

/** The identities in `text`, or a refusal: a file that is there must be well formed. */
function parseIdentities(text: string): InstallIdentities {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShareRecordError(ShareRecordRefusal.Identity);
  }
  if (!isRecord(parsed) || !isIdentity(parsed) || !isInstant(parsed.createdAt))
    throw new ShareRecordError(ShareRecordRefusal.Identity);
  const retired = parsed.retired ?? [];
  if (!Array.isArray(retired) || !retired.every(isRetired)) throw new ShareRecordError(ShareRecordRefusal.Identity);
  const current = { installId: String(parsed.installId), secret: String(parsed.secret), createdAt: parsed.createdAt };
  return { current, retired: retired.map(({ installId, secret, retiredAt }) => ({ installId, secret, retiredAt })) };
}

async function refuseInsideGit(file: string): Promise<void> {
  if (await insideGitWorktree(file)) throw new ShareRecordError(ShareRecordRefusal.InsideGitWorktree);
}

/** The identities kept under `home`, or null when none was ever minted; throws on a malformed file. */
export async function readInstallIdentities(home: string): Promise<InstallIdentities | null> {
  const file = path.join(home, ...INSTALL_IDENTITY_SEGMENTS);
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return text === null ? null : parseIdentities(text);
}

function mint(now: number): InstallIdentities["current"] {
  return {
    installId: randomBytes(INSTALL_ID_BYTES).toString("hex"),
    secret: randomBytes(INSTALL_ID_BYTES).toString("hex"),
    createdAt: new Date(now).toISOString(),
  };
}

/** `kept` with its current identity retired and a fresh one minted; retired ones past retention drop. */
function rotated(kept: InstallIdentities | null, now: number): InstallIdentities {
  if (!kept) return { current: mint(now), retired: [] };
  const { installId, secret } = kept.current;
  const retired = [...kept.retired, { installId, secret, retiredAt: new Date(now).toISOString() }];
  return { current: mint(now), retired: retired.filter((old) => now - Date.parse(old.retiredAt) < RETIRED_ID_KEEP_MS) };
}

async function writeIdentities(file: string, identities: InstallIdentities): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIR });
  const { current, retired } = identities;
  await atomicWriteText(file, `${JSON.stringify({ ...current, retired })}\n`, { mode: PRIVATE_FILE });
  await chmod(file, PRIVATE_FILE);
}

/**
 * The eval CLI's install identity under `home`: the kept one while it is younger than 90 days,
 * else a fresh one, with the old one retired (not overwritten) so a delete can still reach its
 * rows. Refuses a home inside a Git worktree, and an identity file that does not parse, before
 * writing anything.
 */
export async function evalInstallIdentity(home: string, now: () => number = Date.now): Promise<InstallIdentity> {
  const file = path.join(home, ...INSTALL_IDENTITY_SEGMENTS);
  await refuseInsideGit(file);
  const kept = await readInstallIdentities(home);
  const at = now();
  if (kept && at - Date.parse(kept.current.createdAt) < INSTALL_ID_ROTATION_MS)
    return { installId: kept.current.installId, secret: kept.current.secret };
  const next = rotated(kept, at);
  await writeIdentities(file, next);
  return { installId: next.current.installId, secret: next.current.secret };
}

function isSharedEntry(value: unknown): value is SharedEntry {
  if (!isRecord(value)) return false;
  const { installId, campaignId, runId, gradeSeq, contributedAt } = value;
  const ids =
    typeof installId === "string" &&
    INSTALL_ID_PATTERN.test(installId) &&
    typeof campaignId === "string" &&
    CAMPAIGN_ID_PATTERN.test(campaignId) &&
    typeof runId === "string" &&
    RUN_ID_PATTERN.test(runId);
  return ids && Number.isInteger(gradeSeq) && typeof contributedAt === "string" && INSTANT_PATTERN.test(contributedAt);
}

function parseEntry(line: string): SharedEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ShareRecordError(ShareRecordRefusal.Record);
  }
  if (!isSharedEntry(parsed)) throw new ShareRecordError(ShareRecordRefusal.Record);
  return parsed;
}

/** What `ledger share` and `ledger unshare` know about past contributions; tests pass the real one on a temp home. */
export interface ShareRecord {
  /** Every accepted contribution. */
  entries(): Promise<SharedEntry[]>;
  /** Record one accepted contribution, right after the server accepted it. */
  add(entry: SharedEntry): Promise<void>;
  /** Forget every contribution of `installId`, after the server deleted them. */
  forget(installId: string): Promise<void>;
}

/** The record at `$GENEX_EVALS_HOME/secrets/shared.jsonl` under `home`. */
export function shareRecord(home: string): ShareRecord {
  const file = path.join(home, ...SHARED_RECORD_SEGMENTS);
  const entries = async (): Promise<SharedEntry[]> => {
    const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(parseEntry);
  };
  return {
    entries,
    add: async (entry) => {
      await refuseInsideGit(file);
      await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIR });
      await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: PRIVATE_FILE });
    },
    forget: async (installId) => {
      const all = await entries();
      const kept = all.filter((entry) => entry.installId !== installId);
      if (kept.length === all.length) return;
      await refuseInsideGit(file);
      await atomicWriteText(file, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""), { mode: PRIVATE_FILE });
    },
  };
}
