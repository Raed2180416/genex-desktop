/**
 * The ledger writer (§9.2). A row is checked in full before anything touches the disk: the guard
 * (closed schema, then the denylist), the `gradeId` it must carry, the owned-home boundary, and
 * for a holdout the Git-worktree boundary (§6.3). Only then does it take one
 * `appendFile(path, line + "\n", {flag: "a"})`: append-only, never `wx`, never a rewrite, so two
 * runs finishing together both land and a refused row leaves the file neither created nor grown.
 */
import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultHomes, type Homes } from "../../transcript-census.ts";
import { CaseVisibility } from "../vocabulary.ts";
import { guardRow } from "./guard.ts";
import { canonicalJson, sha256Text, shortDigest } from "./hash.ts";
import { type EvalsPaths, insideGitWorktree, ledgerFileFor, refuseOwnedPath } from "./paths.ts";
import { type GradingPins, type LedgerRow, RUN_ROW_SCHEMA, type RunRow } from "./types.ts";

/** Why the writer refused a row that passed the guard. */
export const LedgerRefusal = {
  /** The row's `gradeId` is not the one its runId, grading pins and recordedAt give. */
  GradeIdMismatch: "grade-id-mismatch",
  /** A holdout row for a ledger inside a Git working tree (§6.3). */
  HoldoutInWorktree: "holdout-in-worktree",
  /** The ledger sits inside the studio's or an engine's own data. */
  OwnedOutput: "owned-output",
} as const;
export type LedgerRefusal = (typeof LedgerRefusal)[keyof typeof LedgerRefusal];

/** A write the ledger refused, by typed code. */
export class LedgerWriteError extends Error {
  readonly refusal: LedgerRefusal;
  constructor(refusal: LedgerRefusal, detail: string) {
    super(`ledger write refused (${refusal}): ${detail}`);
    this.name = "LedgerWriteError";
    this.refusal = refusal;
  }
}

/** Where a row goes, and whose homes it must stay out of (default: this user's). */
export interface AppendOptions {
  paths: EvalsPaths;
  homes?: Homes;
}

/** A grade's identity: sha256 of (runId, grading pins, recordedAt), first twelve hex characters (Rule 10). */
export function gradeIdFor(runId: string, grading: GradingPins, recordedAt: string): string {
  return shortDigest(sha256Text(canonicalJson({ runId, grading, recordedAt })));
}

/** `row` with the `gradeId` its runId, grading pins and recordedAt give. */
export function withGradeId(row: RunRow): RunRow {
  return { ...row, gradeId: gradeIdFor(row.runId, row.pins.grading, row.recordedAt) };
}

function assertGradeId(row: LedgerRow): void {
  if (row.schema !== RUN_ROW_SCHEMA) return;
  if (row.gradeId !== gradeIdFor(row.runId, row.pins.grading, row.recordedAt))
    throw new LedgerWriteError(LedgerRefusal.GradeIdMismatch, `gradeId of ${row.runId}`);
}

async function assertWritableFor(row: LedgerRow, file: string, homes: Homes): Promise<void> {
  const owned = await refuseOwnedPath(file, homes);
  if (owned) throw new LedgerWriteError(LedgerRefusal.OwnedOutput, owned);
  const holdout = row.schema === RUN_ROW_SCHEMA && row.case.visibility === CaseVisibility.Holdout;
  if (holdout && (await insideGitWorktree(file)))
    throw new LedgerWriteError(LedgerRefusal.HoldoutInWorktree, "holdout rows stay outside Git working trees");
}

/** Append one row to its ledger file after every check passes; answers the file it landed in. */
export async function appendLedgerRow(value: unknown, options: AppendOptions): Promise<string> {
  const row = guardRow(value);
  assertGradeId(row);
  const file = ledgerFileFor(options.paths, row.schema);
  await assertWritableFor(row, file, options.homes ?? defaultHomes(os.homedir()));
  const line = JSON.stringify(row);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${line}\n`, { flag: "a" });
  return file;
}
