/**
 * The ledger commands: `ledger export --release <sha>` (§9.2 item 2: the per-release public snapshot
 * under `evals/ledger/`), `validate-ledger` (§9: every line of the three files against its closed
 * schema and the grade order) and the machine's own dependencies of `ledger publish`, `ledger
 * share` and `ledger unshare` (§9.4), whose handlers `scripts/evals/remote/` owns: the local ledger
 * as their reader and the ledger guard as their row check.
 */
import { resolveEvalsHome } from "../home.ts";
import { exportLedger, ReleaseRefusal, resolveReleaseSha, selectExportRows } from "../ledger/export.ts";
import { guardRow, LedgerGuardError } from "../ledger/guard.ts";
import { EVALS_HOME_ENV, type EvalsPaths, evalsPaths } from "../ledger/paths.ts";
import { currentRows, LedgerReadError, readRunRows, validateLedger } from "../ledger/read.ts";
import { GIT_SHA_PATTERN } from "../ledger/schema.ts";
import type { RunRow } from "../ledger/types.ts";
import { defaultPublishDeps, type PublishDeps, type RowGuard } from "../remote/publish.ts";
import { defaultShareDeps, defaultUnshareDeps, type ShareDeps, type UnshareDeps } from "../remote/share.ts";
import { parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { CliExit, type Out } from "./exit.ts";

const MESSAGE = {
  exportUsage: "usage: ledger export --release <sha>",
  validateUsage: "usage: validate-ledger",
  noRows: "not-ready no-rows",
  refusedGuard: "refused guard",
  refusedAmbiguous: `refused ${ReleaseRefusal.Ambiguous}`,
  invalid: "invalid",
  wrote: "wrote",
} as const;

const RELEASE_FLAG = "--release";

/** The ledger guard as the remote clients' row check: the refusing rule, never the value. */
export const ledgerRowGuard: RowGuard = (row) => {
  try {
    guardRow(row);
    return { ok: true };
  } catch (error) {
    if (error instanceof LedgerGuardError) return { ok: false, reason: error.rule };
    throw error;
  }
};

/** Every grade of one campaign's runs, oldest first per run, as `ledger publish` uploads them. */
const allGrades = (paths: EvalsPaths) => async (campaignId: string) =>
  (await readRunRows(paths)).filter((row: RunRow) => row.campaignId === campaignId);

/** The current grade of each of one campaign's runs, as `ledger share` sends them. */
const currentGrades = (paths: EvalsPaths) => async (campaignId: string) =>
  currentRows(await readRunRows(paths)).filter((row) => row.campaignId === campaignId);

/** The environment the remote clients read, with the evals home resolved (default `~/.genex-evals`). */
function remoteEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return { ...env, [EVALS_HOME_ENV]: resolveEvalsHome({ env }) };
}

/** `ledger publish`'s machine dependencies, printing through `out`. */
export function systemPublishDeps(out: Out, env: NodeJS.ProcessEnv = process.env): PublishDeps {
  const resolved = remoteEnv(env);
  const paths = evalsPaths(resolved[EVALS_HOME_ENV] ?? "");
  return { ...defaultPublishDeps(resolved), readAllGrades: allGrades(paths), guard: ledgerRowGuard, out };
}

/** `ledger share`'s machine dependencies, printing through `out`. */
export function systemShareDeps(out: Out, env: NodeJS.ProcessEnv = process.env): ShareDeps {
  const resolved = remoteEnv(env);
  const paths = evalsPaths(resolved[EVALS_HOME_ENV] ?? "");
  return { ...defaultShareDeps(resolved), readCurrentRows: currentGrades(paths), guard: ledgerRowGuard, out };
}

/** `ledger unshare`'s machine dependencies, printing through `out`. */
export function systemUnshareDeps(out: Out, env: NodeJS.ProcessEnv = process.env): UnshareDeps {
  return { ...defaultUnshareDeps(remoteEnv(env)), out };
}

/** `ledger export --release <sha>`: nothing is written when the release has no public rows. */
export async function ledgerExportCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  const parsed = parseCliArgs(args, { values: [RELEASE_FLAG] });
  const appSha = parsed?.values.get(RELEASE_FLAG);
  if (parsed === null || parsed.positional.length > 0 || appSha === undefined || !GIT_SHA_PATTERN.test(appSha)) {
    out(MESSAGE.exportUsage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  const rows = await readRunRows(ctx.paths);
  const release = resolveReleaseSha(rows, appSha);
  if ("refusal" in release && release.refusal === ReleaseRefusal.Ambiguous) {
    out(`${MESSAGE.refusedAmbiguous} ${appSha}`);
    return CliExit.Usage;
  }
  if ("refusal" in release || selectExportRows(rows, release.appSha).length === 0) {
    out(`${MESSAGE.noRows} ${appSha}`);
    return CliExit.NotReady;
  }
  try {
    const result = await exportLedger({ paths: ctx.paths, appSha: release.appSha, repoRoot: ctx.root });
    out(`${MESSAGE.wrote} ${result.file} rows=${result.rows} holdouts-skipped=${result.holdoutsSkipped}`);
    return CliExit.Ok;
  } catch (error) {
    if (!(error instanceof LedgerGuardError)) throw error;
    out(`${MESSAGE.refusedGuard} ${error.field} ${error.rule}`);
    return CliExit.Refused;
  }
}

/** `validate-ledger`: the counts of a valid ledger, or the first bad line (`file:line`) and exit 1. */
export async function validateLedgerCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  if (args.length > 0) {
    out(MESSAGE.validateUsage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  try {
    const counts = await validateLedger(ctx.paths);
    out(`runs ${counts.runs} current ${counts.currentRuns} pairwise ${counts.pairwise} human ${counts.human}`);
    return CliExit.Ok;
  } catch (error) {
    if (!(error instanceof LedgerReadError)) throw error;
    out(`${MESSAGE.invalid} ${error.message}`);
    return CliExit.Refused;
  }
}
