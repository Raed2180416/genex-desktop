/**
 * `ledger publish <campaign> [--publish-evidence]` (M5.2, §20.2): uploads the owner's rows of a
 * campaign to genex-demo's `/api/evals/desktop/*` with the `evals_ingest` key file, and nothing
 * else. Each run's current grade (the highest `gradeSeq`, as `currentRows()` picks it) goes up as
 * the run upsert (idempotent on `runId`), so the run's typed columns (first boot, first playable,
 * a campaign void) are the graded ones; then every grade, oldest first, goes up as a grade upsert
 * (idempotent on (`runId`, `gradeSeq`)), so a re-run or a retry cannot inflate rows and the server
 * keeps the whole history. With `--publish-evidence`, the run's frames and videos under
 * `$GENEX_EVALS_HOME/evidence/<runId>/` go to presigned PUTs; symlinks and anything outside that
 * folder are never read.
 *
 * Every row is checked before the key is read or anything is sent: it belongs to the campaign,
 * its run id has the ledger shape, the ledger guard accepts it and it holds nothing
 * credential-shaped. One failing row refuses the whole campaign. The ledger reader and guard are
 * injected (`scripts/evals/ledger/` owns them).
 */
import { constants, type Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { containsSecret, redactSecrets } from "../../../src/shared/redact.ts";
import { type CommandHandler, EXIT_USAGE } from "../cli/exit.ts";
import { compareGrades } from "../ledger/read.ts";
import { CAMPAIGN_ID_PATTERN, RUN_ID_PATTERN, RUN_ROW_SCHEMA, type RunRow } from "../ledger/types.ts";
import {
  ClientRefusal,
  createIngestClient,
  EVIDENCE_MAX_BYTES_BY_TYPE,
  evidenceAsk,
  type IngestClient,
  RemoteError,
  runsOrigin,
  type Transport,
} from "./client.ts";
import { EVIDENCE_MAX_OBJECTS_PER_RUN, EvidenceContentType } from "./contract.ts";
import { EVALS_HOME_ENV } from "../home.ts";
import { type IngestKey, KeyFileError, readIngestKey } from "./key-file.ts";

/** A command that ran and did what it was asked. */
export const EXIT_OK = 0;
/** A command that refused its input or stopped on a failure; nothing more was sent. */
export const EXIT_REFUSED = 1;
/** How deep under a run's evidence folder files are looked for. */
const EVIDENCE_MAX_DEPTH = 3;
/** Evidence files by extension. */
const EVIDENCE_TYPE_BY_EXTENSION: Readonly<Record<string, EvidenceContentType>> = {
  ".jpg": EvidenceContentType.Jpeg,
  ".jpeg": EvidenceContentType.Jpeg,
  ".png": EvidenceContentType.Png,
  ".webm": EvidenceContentType.Webm,
};
const PUBLISH_EVIDENCE_FLAG = "--publish-evidence";

/** What the operator reads, as codes. */
export const PublishLine = {
  Refused: "refused",
  Published: "published",
  Evidence: "evidence",
  Stopped: "stopped",
  Done: "done",
} as const;
export type PublishLine = (typeof PublishLine)[keyof typeof PublishLine];

/** Why a row was refused before anything was sent. */
export const RowRefusal = {
  NoRows: "no-rows",
  OtherCampaign: "other-campaign",
  BadSchema: "bad-schema",
  BadRunId: "bad-run-id",
  Guard: "guard",
  Credential: "credential",
  SharingRemoved: "sharing-removed",
} as const;
export type RowRefusal = (typeof RowRefusal)[keyof typeof RowRefusal];

/** The ledger guard's answer for one row. */
export type RowGuardVerdict = { ok: true } | { ok: false; reason: string };
/** The ledger guard (`scripts/evals/ledger/guard.ts`): closed schema plus denylist. */
export type RowGuard = (row: RunRow) => RowGuardVerdict;
/** Every grade of every run of a campaign, from the local ledger. */
export type AllGradesReader = (campaignId: string) => Promise<readonly RunRow[]>;

/** One evidence file of a run. */
export interface EvidenceObject {
  index: number;
  contentType: EvidenceContentType;
  file: string;
}

/** What `ledger publish` reads and where it writes; tests pass fakes. */
export interface PublishDeps {
  env: Readonly<Record<string, string | undefined>>;
  readAllGrades: AllGradesReader;
  guard: RowGuard;
  readKey: (env: Readonly<Record<string, string | undefined>>) => Promise<IngestKey>;
  listEvidence: (runId: string) => Promise<readonly EvidenceObject[]>;
  readEvidence: (file: string) => Promise<Uint8Array>;
  transport?: Partial<Transport>;
  out: (line: string) => void;
}

/** The real key reader and evidence folder for `env`; the caller adds the ledger reader and guard. */
export function defaultPublishDeps(
  env: Readonly<Record<string, string | undefined>>,
): Omit<PublishDeps, "readAllGrades" | "guard"> {
  const home = env[EVALS_HOME_ENV];
  return {
    env,
    readKey: (keyEnv) => readIngestKey(keyEnv),
    listEvidence: home ? evidenceLister(home) : async () => [],
    readEvidence: readNoFollow,
    out: (line) => console.log(line),
  };
}

/** The first row that fails a check, as a refusal code, or null when every row may leave. */
export function refuseRows(rows: readonly RunRow[], campaignId: string, guard: RowGuard): RowRefusal | null {
  if (!rows.length) return RowRefusal.NoRows;
  for (const row of rows) {
    const refusal = refuseRow(row, campaignId, guard);
    if (refusal) return refusal;
  }
  return null;
}

function refuseRow(row: RunRow, campaignId: string, guard: RowGuard): RowRefusal | null {
  if (row.schema !== RUN_ROW_SCHEMA) return RowRefusal.BadSchema;
  if (row.campaignId !== campaignId) return RowRefusal.OtherCampaign;
  if (!RUN_ID_PATTERN.test(row.runId)) return RowRefusal.BadRunId;
  if (!guard(row).ok) return RowRefusal.Guard;
  if (containsSecret(JSON.stringify(row))) return RowRefusal.Credential;
  return null;
}

/** The API origin, or why there is none: removed by the fork (`STUDIO_RUNS_URL=`) or unsafe. */
export function originOrRefusal(
  env: Readonly<Record<string, string | undefined>>,
): string | { refused: RowRefusal | ClientRefusal } {
  try {
    return runsOrigin(env) ?? { refused: RowRefusal.SharingRemoved };
  } catch {
    return { refused: ClientRefusal.OriginInvalid };
  }
}

/** Each run's grades oldest first in the ledger's grade order (the last is the current one), runs in first-seen order. */
function gradesByRun(rows: readonly RunRow[]): RunRow[][] {
  const runs = new Map<string, RunRow[]>();
  for (const row of rows) runs.set(row.runId, [...(runs.get(row.runId) ?? []), row]);
  return [...runs.values()].map((grades) => grades.toSorted(compareGrades));
}

/** Publish one campaign; returns the exit code. */
export async function publishCampaign(
  campaignId: string,
  options: { publishEvidence: boolean },
  deps: PublishDeps,
): Promise<number> {
  const origin = originOrRefusal(deps.env);
  const rows = await deps.readAllGrades(campaignId);
  const refusal = typeof origin === "string" ? refuseRows(rows, campaignId, deps.guard) : origin.refused;
  if (refusal || typeof origin !== "string") {
    deps.out(`${PublishLine.Refused} ${refusal}`);
    return EXIT_REFUSED;
  }
  try {
    const client = createIngestClient({ origin, key: await deps.readKey(deps.env), transport: deps.transport });
    for (const grades of gradesByRun(rows)) {
      await publishRun(client, grades, deps.out);
      if (options.publishEvidence) await publishEvidence(client, grades[0]?.runId ?? "", deps);
    }
  } catch (error) {
    deps.out(`${PublishLine.Stopped} ${stopCode(error)}`);
    return EXIT_REFUSED;
  }
  deps.out(`${PublishLine.Done} ${rows.length}`);
  return EXIT_OK;
}

/** The current grade as the run upsert, then every grade oldest first; the server keeps the highest. */
async function publishRun(client: IngestClient, grades: readonly RunRow[], out: (line: string) => void): Promise<void> {
  const current = grades.at(-1);
  if (!current) return;
  const run = await client.publishRun({ row: current, evalSha: current.pins.recorded.evalSha });
  out(`${PublishLine.Published} ${current.runId} ${current.gradeSeq} ${run.created ? "created" : "replaced"}`);
  for (const row of grades) {
    const grade = await client.publishGrade(row.runId, { row });
    out(`${PublishLine.Published} ${row.runId} ${row.gradeSeq} ${grade.created ? "created" : "replaced"}`);
  }
}

async function publishEvidence(client: IngestClient, runId: string, deps: PublishDeps): Promise<void> {
  const objects = (await deps.listEvidence(runId)).slice(0, EVIDENCE_MAX_OBJECTS_PER_RUN);
  if (!objects.length) return;
  const files = await Promise.all(
    objects.map(async (object) => ({ object, bytes: await deps.readEvidence(object.file) })),
  );
  const asks = files.map(({ object, bytes }) => evidenceAsk(object.index, object.contentType, bytes));
  const { uploads } = await client.presignEvidence(runId, { objects: asks });
  for (const upload of uploads) {
    const at = asks.findIndex((ask) => ask.index === upload.index);
    const ask = asks[at];
    const file = files[at];
    if (ask && file) await client.uploadEvidence(upload, ask, file.bytes);
  }
  deps.out(`${PublishLine.Evidence} ${runId} ${uploads.length}`);
}

/** A file's bytes, refusing a symlink swapped in after the folder was listed. */
async function readNoFollow(file: string): Promise<Uint8Array> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function stopCode(error: unknown): string {
  if (error instanceof RemoteError || error instanceof KeyFileError) return error.code;
  return redactSecrets(error instanceof Error ? error.name : "error");
}

/**
 * The evidence files of a run: regular `.png`/`.jpg`/`.jpeg`/`.webm` files under
 * `<home>/evidence/<runId>/`, a few folders deep, sorted by path and numbered in that order.
 * A run id that is not a ledger run id, a run folder that resolves outside the evidence root,
 * and every symlink are skipped, so nothing outside the run's own folder is ever read.
 */
export function evidenceLister(home: string): (runId: string) => Promise<readonly EvidenceObject[]> {
  return async (runId) => {
    const dir = path.join(home, "evidence", runId);
    if (!RUN_ID_PATTERN.test(runId) || !(await isOwnFolder(path.join(home, "evidence"), dir))) return [];
    const files = (await walk(dir, 0)).toSorted();
    const objects: EvidenceObject[] = [];
    for (const file of files) {
      const contentType = EVIDENCE_TYPE_BY_EXTENSION[path.extname(file).toLowerCase()];
      const size = contentType
        ? await lstat(file).then(
            (info) => info.size,
            () => Number.POSITIVE_INFINITY,
          )
        : 0;
      if (contentType && size <= EVIDENCE_MAX_BYTES_BY_TYPE[contentType])
        objects.push({ index: objects.length, contentType, file });
    }
    return objects;
  };
}

/** Whether `dir` is a real folder (not a link) whose real path is inside `root`'s. */
async function isOwnFolder(root: string, dir: string): Promise<boolean> {
  const info = await lstat(dir).catch(() => null);
  if (!info?.isDirectory()) return false;
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  return realDir.startsWith(`${realRoot}${path.sep}`);
}

async function walk(dir: string, depth: number): Promise<string[]> {
  if (depth > EVIDENCE_MAX_DEPTH) return [];
  const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(file, depth + 1);
      return entry.isFile() ? [file] : [];
    }),
  );
  return nested.flat();
}

/** `<campaign> [--publish-evidence]`, or null for anything else. */
export function parsePublishArgs(args: readonly string[]): { campaignId: string; publishEvidence: boolean } | null {
  const [campaignId, ...flags] = args;
  const known = flags.every((flag) => flag === PUBLISH_EVIDENCE_FLAG);
  if (!campaignId || !CAMPAIGN_ID_PATTERN.test(campaignId) || !known) return null;
  return { campaignId, publishEvidence: flags.includes(PUBLISH_EVIDENCE_FLAG) };
}

/** The `ledger publish` handler for the eval CLI's command table. */
export function ledgerPublishCommand(deps: PublishDeps): CommandHandler {
  return async (args) => {
    const parsed = parsePublishArgs(args);
    if (!parsed) {
      deps.out(`usage: ledger publish <campaign> [${PUBLISH_EVIDENCE_FLAG}]`);
      return EXIT_USAGE;
    }
    return publishCampaign(parsed.campaignId, { publishEvidence: parsed.publishEvidence }, deps);
  };
}
