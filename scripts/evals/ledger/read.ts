/**
 * The ledger reader (§9.2, Rule 10). A file is read whole and every line must be a valid row of
 * that file's schema: a malformed or foreign line throws, naming its number. A regrade is not an
 * observation: `currentRows()` is the only definition of "latest" (by `gradeSeq`, then
 * `recordedAt`, then `gradeId`), and two different rows for one (`runId`, `gradeSeq`) are an
 * error, while an identical repeat (a retried append) is tolerated. `validateLedger` runs all of
 * it over the three files, as `npm run eval -- validate-ledger` reports it.
 */
import { readFile } from "node:fs/promises";
import { canonicalJson } from "./hash.ts";
import type { EvalsPaths } from "./paths.ts";
import { LedgerSchemaError, validateLedgerRow } from "./schema.ts";
import {
  HUMAN_ROW_SCHEMA,
  type HumanRow,
  type LedgerRow,
  PAIRWISE_ROW_SCHEMA,
  type PairwiseRow,
  RUN_ROW_SCHEMA,
  type RunRow,
} from "./types.ts";

/** A ledger line that could not be read, by file and 1-based line number. */
export class LedgerReadError extends Error {
  readonly file: string;
  readonly line: number;
  constructor(file: string, line: number, detail: string) {
    super(`${file}:${line}: ${detail}`);
    this.name = "LedgerReadError";
    this.file = file;
    this.line = line;
  }
}

/** A row with the line it was read from, for naming a conflict. */
export interface LedgerLine<T extends LedgerRow = LedgerRow> {
  row: T;
  line: number;
}

/** Every row of one ledger file with its line number; a missing file is an empty ledger. */
export async function readLedgerLines(file: string, schema?: LedgerRow["schema"]): Promise<LedgerLine[]> {
  const text = await readText(file);
  if (text === null || text === "") return [];
  const lines = text.split("\n");
  // An append always ends its line, so the last piece is empty; a torn write there is parsed, and named.
  const tail = lines.pop();
  if (tail !== "") lines.push(tail ?? "");
  return lines.map((line, index) => ({ row: parseLine(file, index + 1, line, schema), line: index + 1 }));
}

/** Every row of one ledger file, in file order. */
export async function readLedgerFile(file: string, schema?: LedgerRow["schema"]): Promise<LedgerRow[]> {
  return (await readLedgerLines(file, schema)).map(({ row }) => row);
}

/** Every run row in the ledger, in file order (all grades, not only the current ones). */
export async function readRunRows(paths: EvalsPaths): Promise<RunRow[]> {
  return (await readLedgerFile(paths.ledgerFiles.runs, RUN_ROW_SCHEMA)) as RunRow[];
}

/** Every pairwise row in the ledger, in file order. */
export async function readPairwiseRows(paths: EvalsPaths): Promise<PairwiseRow[]> {
  return (await readLedgerFile(paths.ledgerFiles.pairwise, PAIRWISE_ROW_SCHEMA)) as PairwiseRow[];
}

/** Every human review row in the ledger, in file order. */
export async function readHumanRows(paths: EvalsPaths): Promise<HumanRow[]> {
  return (await readLedgerFile(paths.ledgerFiles.human, HUMAN_ROW_SCHEMA)) as HumanRow[];
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseLine(file: string, line: number, text: string, schema?: LedgerRow["schema"]): LedgerRow {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LedgerReadError(file, line, "not a JSON row");
  }
  try {
    const row = validateLedgerRow(value);
    if (schema && row.schema !== schema)
      throw new LedgerReadError(file, line, `a ${row.schema} row in a ${schema} file`);
    return row;
  } catch (error) {
    if (error instanceof LedgerSchemaError) throw new LedgerReadError(file, line, error.message);
    throw error;
  }
}

/** The grade order (Rule 10): `gradeSeq`, then `recordedAt`, then `gradeId`; positive when `a` is later. */
export function compareGrades(a: RunRow, b: RunRow): number {
  if (a.gradeSeq !== b.gradeSeq) return a.gradeSeq - b.gradeSeq;
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  if (a.gradeId === b.gradeId) return 0;
  return a.gradeId < b.gradeId ? -1 : 1;
}

/** Throws when two different rows share a (`runId`, `gradeSeq`), naming the later line. */
export function assertNoConflictingGrades(lines: readonly LedgerLine<RunRow>[], file = "runs"): void {
  const seen = new Map<string, string>();
  for (const { row, line } of lines) {
    const key = `${row.runId}#${row.gradeSeq}`;
    const content = canonicalJson(row);
    const earlier = seen.get(key);
    if (earlier !== undefined && earlier !== content)
      throw new LedgerReadError(file, line, `a different row for ${row.runId} grade ${row.gradeSeq}`);
    seen.set(key, content);
  }
}

/** The latest grade of each run, in the order each run first appears; conflicting regrades throw. */
export function currentRows(rows: readonly RunRow[]): RunRow[] {
  assertNoConflictingGrades(rows.map((row, index) => ({ row, line: index + 1 })));
  const latest = new Map<string, RunRow>();
  for (const row of rows) {
    const held = latest.get(row.runId);
    if (!held || compareGrades(row, held) > 0) latest.set(row.runId, row);
  }
  return [...latest.values()];
}

/** What a valid ledger holds: rows per file, and runs (not grades) in the run file. */
export interface LedgerCounts {
  runs: number;
  currentRuns: number;
  pairwise: number;
  human: number;
}

/** Reads and checks all three ledger files, or throws a `LedgerReadError` naming the first bad line. */
export async function validateLedger(paths: EvalsPaths): Promise<LedgerCounts> {
  const runLines = (await readLedgerLines(paths.ledgerFiles.runs, RUN_ROW_SCHEMA)) as LedgerLine<RunRow>[];
  assertNoConflictingGrades(runLines, paths.ledgerFiles.runs);
  const runs = runLines.map(({ row }) => row);
  return {
    runs: runs.length,
    currentRuns: currentRows(runs).length,
    pairwise: (await readPairwiseRows(paths)).length,
    human: (await readHumanRows(paths)).length,
  };
}
