/**
 * The per-release ledger export (§9.2 item 2): `evals/ledger/export-<appSha>.jsonl`, committed
 * with the baseline promotion. It holds the current grade of every public run in the campaigns
 * that evaluated this app build, including the raw lanes those campaigns co-ran (their `appSha`
 * is n/a); holdouts are skipped (§6.3), pairwise and human rows stay local. Every exported row
 * passes the guard first; one refusal writes nothing. The file is replaced whole through a
 * sibling temp file and a rename, sorted by runId, so a re-export after a regrade is a clean diff.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CaseVisibility } from "../vocabulary.ts";
import { guardRow } from "./guard.ts";
import type { EvalsPaths } from "./paths.ts";
import { currentRows, readRunRows } from "./read.ts";
import { GIT_SHA_PATTERN } from "./schema.ts";
import { isMeasured, type RunRow } from "./types.ts";

/** Where exports are committed, relative to the repository root. */
export const LEDGER_EXPORT_DIR = "evals/ledger";

/** The export's file name for one app build; the sha must be a commit, never a path. */
export function exportFileName(appSha: string): string {
  if (!GIT_SHA_PATTERN.test(appSha)) throw new TypeError("an export needs the app build's commit sha");
  return `export-${appSha}.jsonl`;
}

const byRunId = (a: RunRow, b: RunRow) => (a.runId < b.runId ? -1 : Number(a.runId > b.runId));

/** The current rows of every campaign that ran this app build, public and holdout alike, sorted by runId. */
function releaseRows(rows: readonly RunRow[], appSha: string): RunRow[] {
  const current = currentRows(rows);
  const campaigns = new Set(current.filter((row) => row.pins.run.appSha === appSha).map((row) => row.campaignId));
  return current.filter((row) => campaigns.has(row.campaignId)).sort(byRunId);
}

/** Why a `--release` sha names no single app build. */
export const ReleaseRefusal = {
  /** No measured row's app sha starts with it. */
  NoRows: "no-rows",
  /** More than one measured app sha starts with it. */
  Ambiguous: "ambiguous-release",
} as const;
export type ReleaseRefusal = (typeof ReleaseRefusal)[keyof typeof ReleaseRefusal];

/**
 * The full app sha a `--release` sha (7–40 hex, as `campaign plan` and `compare` print it) names
 * among the ledger's current rows, or why there is none: a short sha must match exactly one build.
 */
export function resolveReleaseSha(
  rows: readonly RunRow[],
  prefix: string,
): { appSha: string } | { refusal: ReleaseRefusal } {
  const matches = new Set<string>();
  for (const row of currentRows(rows)) {
    const sha = row.pins.run.appSha;
    if (isMeasured(sha) && sha.startsWith(prefix)) matches.add(sha);
  }
  const [appSha, ...others] = matches;
  if (appSha === undefined) return { refusal: ReleaseRefusal.NoRows };
  return others.length > 0 ? { refusal: ReleaseRefusal.Ambiguous } : { appSha };
}

/** The rows an export of `appSha` holds: current grades, public cases, the release's campaigns. */
export function selectExportRows(rows: readonly RunRow[], appSha: string): RunRow[] {
  return releaseRows(rows, appSha).filter((row) => row.case.visibility === CaseVisibility.Public);
}

/** What an export wrote. */
export interface ExportResult {
  file: string;
  rows: number;
  holdoutsSkipped: number;
}

/** What `exportLedger` reads and where it writes. */
export interface ExportOptions {
  paths: EvalsPaths;
  appSha: string;
  repoRoot: string;
}

/** Writes `evals/ledger/export-<appSha>.jsonl` under `repoRoot` from the local ledger. */
export async function exportLedger({ paths, appSha, repoRoot }: ExportOptions): Promise<ExportResult> {
  const name = exportFileName(appSha);
  const release = releaseRows(await readRunRows(paths), appSha);
  const rows = release.filter((row) => row.case.visibility === CaseVisibility.Public);
  const text = rows.map((row) => `${JSON.stringify(guardRow(row))}\n`).join("");
  const file = path.join(path.resolve(repoRoot), LEDGER_EXPORT_DIR, name);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temp, text, { flag: "wx" });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
  return { file, rows: rows.length, holdoutsSkipped: release.length - rows.length };
}
