/**
 * `ledger share <campaign> [--yes]` (§9.4, M5.5): anyone running evals may share a campaign's
 * public-case rows with genex-demo's anonymous contributions route. Holdout rows are withheld and
 * never printed. Every row that would leave is checked first (campaign, run id, the ledger guard,
 * nothing credential-shaped); rows this machine already shared (the same run and grade, under any
 * of its identities) are skipped, and at most the per-install daily cap goes per run, the rest
 * waiting for a later run. What will leave is printed exactly; then the operator is asked, each
 * time, unless `--yes` was given for this one campaign. Rows go one by one as `community-eval`
 * contributions with no Authorization header and no cookie, stamped with the consent version and
 * the eval CLI's own random install id, and each accepted row is recorded at once; the kill
 * switch (410) and a rate limit stop the send, and the next run resumes after the last accepted row.
 *
 * `ledger unshare [--yes]` deletes, after a yes, every contribution of every install identity this
 * machine kept (the current one and those retired within the server's retention), each proven by
 * its own secret; the server keeps DELETE open while the kill switch is on.
 *
 * The identities and the record live under `$GENEX_EVALS_HOME/secrets/` (`share-record.ts`).
 */
import { createInterface } from "node:readline/promises";
import { ContributionKind, RUN_SHARING_CONSENT_VERSION } from "../../../src/shared/run-sharing.ts";
import { type CommandHandler, EXIT_USAGE } from "../cli/exit.ts";
import { EVALS_HOME_ENV } from "../home.ts";
import { CAMPAIGN_ID_PATTERN, type RunRow } from "../ledger/types.ts";
import { CaseVisibility } from "../vocabulary.ts";
import { type ContributionClient, createContributionClient, RemoteError, type Transport } from "./client.ts";
import { CONTRIBUTION_DAILY_CAP_PER_INSTALL, type CommunityEvalContribution, DesktopEvalStatus } from "./contract.ts";
import { EXIT_OK, EXIT_REFUSED, originOrRefusal, type RowGuard, refuseRows } from "./publish.ts";
import {
  evalInstallIdentity,
  type InstallIdentities,
  type InstallIdentity,
  readInstallIdentities,
  ShareRecordError,
  type ShareRecord,
  shareRecord,
  sharedKey,
} from "./share-record.ts";

const YES_FLAG = "--yes";

/** What the operator reads from `ledger share`, as codes. */
export const ShareLine = {
  Refused: "refused",
  Withheld: "withheld-holdouts",
  /** Rows this machine already shared, skipped. */
  AlreadyShared: "already-shared",
  /** Rows past the daily cap, left for a later run. */
  Deferred: "deferred",
  Row: "row",
  Declined: "declined",
  Shared: "shared",
  Stopped: "stopped",
  Done: "done",
} as const;
export type ShareLine = (typeof ShareLine)[keyof typeof ShareLine];

/** What the operator reads from `ledger unshare`, as codes. */
export const UnshareLine = {
  Refused: "refused",
  /** No identity was ever minted here, so nothing was shared and nothing is sent. */
  NoIdentity: "no-identity",
  /** An install id whose rows will be deleted. */
  Identity: "identity",
  Declined: "declined",
  Deleted: "deleted",
  Stopped: "stopped",
  Done: "done",
} as const;
export type UnshareLine = (typeof UnshareLine)[keyof typeof UnshareLine];

/** The latest grade of each run of a campaign (the ledger's `currentRows()`). */
export type CurrentRowsReader = (campaignId: string) => Promise<readonly RunRow[]>;

/** What `ledger share` reads, asks and sends through; tests pass fakes. */
export interface ShareDeps {
  env: Readonly<Record<string, string | undefined>>;
  readCurrentRows: CurrentRowsReader;
  guard: RowGuard;
  /** Ask the operator; true only for an explicit yes. */
  confirm: (question: string) => Promise<boolean>;
  identity: () => Promise<InstallIdentity>;
  /** What this machine already shared; each accepted row is added at once. */
  record: ShareRecord;
  transport?: Partial<Transport>;
  /** The clock a record entry is stamped with. */
  now?: () => number;
  out: (line: string) => void;
}

/** What `ledger unshare` reads, asks and sends through; tests pass fakes. */
export interface UnshareDeps {
  env: Readonly<Record<string, string | undefined>>;
  /** Every identity kept here, or null when none was ever minted. */
  identities: () => Promise<InstallIdentities | null>;
  record: ShareRecord;
  confirm: (question: string) => Promise<boolean>;
  transport?: Partial<Transport>;
  out: (line: string) => void;
}

const noHome = () => Promise.reject(new Error(`${EVALS_HOME_ENV} is not set`));
/** A record for an environment with no eval home: every use refuses. */
const NO_HOME_RECORD: ShareRecord = { entries: noHome, add: noHome, forget: noHome };

/** The real prompt, identity file and record for `env`; the caller adds the ledger reader and guard. */
export function defaultShareDeps(
  env: Readonly<Record<string, string | undefined>>,
): Omit<ShareDeps, "readCurrentRows" | "guard"> {
  const home = env[EVALS_HOME_ENV];
  return {
    env,
    confirm: terminalConfirm,
    identity: () => (home ? evalInstallIdentity(home) : noHome()),
    record: home ? shareRecord(home) : NO_HOME_RECORD,
    now: Date.now,
    out: (line) => console.log(line),
  };
}

/** The real prompt, identity file and record of `ledger unshare` for `env`. */
export function defaultUnshareDeps(env: Readonly<Record<string, string | undefined>>): UnshareDeps {
  const home = env[EVALS_HOME_ENV];
  return {
    env,
    identities: () => (home ? readInstallIdentities(home) : noHome()),
    record: home ? shareRecord(home) : NO_HOME_RECORD,
    confirm: terminalConfirm,
    out: (line) => console.log(line),
  };
}

/** Ask on the terminal; only `y` or `yes` counts. */
export async function terminalConfirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

/** The rows not yet shared from this machine, or null (after saying why) when the record is unreadable. */
async function unsharedRows(rows: readonly RunRow[], deps: ShareDeps): Promise<RunRow[] | null> {
  try {
    const shared = new Set((await deps.record.entries()).map(sharedKey));
    const pending = rows.filter((row) => !shared.has(sharedKey(row)));
    if (pending.length < rows.length) deps.out(`${ShareLine.AlreadyShared} ${rows.length - pending.length}`);
    return pending;
  } catch (error) {
    deps.out(`${ShareLine.Stopped} ${stopDetail(error)}`);
    return null;
  }
}

/** Share one campaign's public rows; returns the exit code. */
export async function shareCampaign(campaignId: string, options: { yes: boolean }, deps: ShareDeps): Promise<number> {
  const origin = originOrRefusal(deps.env);
  const current = await deps.readCurrentRows(campaignId);
  const rows = current.filter((row) => row.case.visibility === CaseVisibility.Public);
  const refusal = typeof origin === "string" ? refuseRows(rows, campaignId, deps.guard) : origin.refused;
  if (refusal || typeof origin !== "string") {
    deps.out(`${ShareLine.Refused} ${refusal}`);
    return EXIT_REFUSED;
  }
  if (rows.length < current.length) deps.out(`${ShareLine.Withheld} ${current.length - rows.length}`);
  const pending = await unsharedRows(rows, deps);
  if (pending === null) return EXIT_REFUSED;
  const batch = pending.slice(0, CONTRIBUTION_DAILY_CAP_PER_INSTALL);
  if (batch.length < pending.length) deps.out(`${ShareLine.Deferred} ${pending.length - batch.length}`);
  if (batch.length === 0) {
    deps.out(`${ShareLine.Done} 0`);
    return EXIT_OK;
  }
  for (const row of batch) deps.out(JSON.stringify(row));
  const question = `Share these ${batch.length} rows anonymously with ${origin} (${ContributionKind.CommunityEval}, consent ${RUN_SHARING_CONSENT_VERSION})?`;
  if (!options.yes && !(await deps.confirm(question))) {
    deps.out(ShareLine.Declined);
    return EXIT_REFUSED;
  }
  return sendRows(origin, batch, deps);
}

async function sendRows(origin: string, rows: readonly RunRow[], deps: ShareDeps): Promise<number> {
  const client = createContributionClient({ origin, transport: deps.transport });
  const now = deps.now ?? Date.now;
  try {
    const { installId, secret } = await deps.identity();
    for (const row of rows) {
      const contribution: CommunityEvalContribution = {
        kind: ContributionKind.CommunityEval,
        installId,
        consentVersion: RUN_SHARING_CONSENT_VERSION,
        row,
      };
      await client.contribute(contribution, secret);
      const { campaignId, runId, gradeSeq } = row;
      await deps.record.add({ installId, campaignId, runId, gradeSeq, contributedAt: new Date(now()).toISOString() });
      deps.out(`${ShareLine.Shared} ${row.runId}`);
    }
  } catch (error) {
    deps.out(`${ShareLine.Stopped} ${stopDetail(error)}`);
    return EXIT_REFUSED;
  }
  deps.out(`${ShareLine.Done} ${rows.length}`);
  return EXIT_OK;
}

function stopDetail(error: unknown): string {
  if (error instanceof ShareRecordError) return error.code;
  if (!(error instanceof RemoteError)) return "identity";
  return error.retryAfterS === null ? error.code : `${error.code} retry-after=${error.retryAfterS}s`;
}

/** `<campaign> [--yes]`, or null for anything else. */
export function parseShareArgs(args: readonly string[]): { campaignId: string; yes: boolean } | null {
  const [campaignId, ...flags] = args;
  const known = flags.every((flag) => flag === YES_FLAG);
  if (!campaignId || !CAMPAIGN_ID_PATTERN.test(campaignId) || !known) return null;
  return { campaignId, yes: flags.includes(YES_FLAG) };
}

/** The `ledger share` handler for the eval CLI's command table. */
export function ledgerShareCommand(deps: ShareDeps): CommandHandler {
  return async (args) => {
    const parsed = parseShareArgs(args);
    if (!parsed) {
      deps.out(`usage: ledger share <campaign> [${YES_FLAG}]`);
      return EXIT_USAGE;
    }
    return shareCampaign(parsed.campaignId, { yes: parsed.yes }, deps);
  };
}

/** How many rows the server deleted for one identity; a 404 means none were left. */
async function deleteOrGone(client: ContributionClient, identity: InstallIdentity): Promise<number> {
  try {
    return (await client.deleteContributions(identity.installId, identity.secret)).deleted;
  } catch (error) {
    if (error instanceof RemoteError && error.status === DesktopEvalStatus.NotFound) return 0;
    throw error;
  }
}

/** Delete one identity's rows and forget them locally; false (after saying why) when it failed. */
async function unshareIdentity(client: ContributionClient, identity: InstallIdentity, deps: UnshareDeps) {
  try {
    const deleted = await deleteOrGone(client, identity);
    await deps.record.forget(identity.installId);
    deps.out(`${UnshareLine.Deleted} ${identity.installId} ${deleted}`);
    return true;
  } catch (error) {
    deps.out(`${UnshareLine.Stopped} ${identity.installId} ${stopDetail(error)}`);
    return false;
  }
}

/** Every identity kept here, or null (after saying why) when the identity file is refused. */
async function keptIdentities(deps: UnshareDeps): Promise<InstallIdentity[] | null> {
  try {
    const kept = await deps.identities();
    return kept ? [kept.current, ...kept.retired].map(({ installId, secret }) => ({ installId, secret })) : [];
  } catch (error) {
    deps.out(`${UnshareLine.Refused} ${stopDetail(error)}`);
    return null;
  }
}

/** Delete every row every kept identity shared; returns the exit code. */
export async function unshareAll(options: { yes: boolean }, deps: UnshareDeps): Promise<number> {
  const origin = originOrRefusal(deps.env);
  if (typeof origin !== "string") {
    deps.out(`${UnshareLine.Refused} ${origin.refused}`);
    return EXIT_REFUSED;
  }
  const identities = await keptIdentities(deps);
  if (identities === null) return EXIT_REFUSED;
  if (identities.length === 0) {
    deps.out(UnshareLine.NoIdentity);
    return EXIT_OK;
  }
  for (const identity of identities) deps.out(`${UnshareLine.Identity} ${identity.installId}`);
  const question = `Delete every row these ${identities.length} install ids shared with ${origin}?`;
  if (!options.yes && !(await deps.confirm(question))) {
    deps.out(UnshareLine.Declined);
    return EXIT_REFUSED;
  }
  const client = createContributionClient({ origin, transport: deps.transport });
  let deleted = 0;
  for (const identity of identities) if (await unshareIdentity(client, identity, deps)) deleted++;
  deps.out(`${UnshareLine.Done} ${deleted}`);
  return deleted === identities.length ? EXIT_OK : EXIT_REFUSED;
}

/** `[--yes]`, or null for anything else. */
export function parseUnshareArgs(args: readonly string[]): { yes: boolean } | null {
  if (args.length > 1 || !args.every((flag) => flag === YES_FLAG)) return null;
  return { yes: args.length === 1 };
}

/** The `ledger unshare` handler for the eval CLI's command table. */
export function ledgerUnshareCommand(deps: UnshareDeps): CommandHandler {
  return async (args) => {
    const parsed = parseUnshareArgs(args);
    if (!parsed) {
      deps.out(`usage: ledger unshare [${YES_FLAG}]`);
      return EXIT_USAGE;
    }
    return unshareAll(parsed, deps);
  };
}
