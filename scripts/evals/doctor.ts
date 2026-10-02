/**
 * `npm run eval -- doctor` (§12): read-only checks that a machine can run live lanes. Node 24; both
 * CLIs found by the app's discovery, with their versions; the eval homes signed in (status only);
 * the host skills that raw Codex will disable, listed; Playwright's Chromium present (never
 * downloaded); free disk; `$GENEX_EVALS_HOME` outside any repository or instruction file; this
 * process's `CLAUDE_CONFIG_DIR`/`CODEX_HOME` naming no other home (the precondition `campaign run`
 * and grading refuse on); and each signed-in provider's quota windows against the ceiling. Nothing
 * is installed or spent. The quota check opens a status-only CLI session per signed-in eval home
 * (no turn is sent; its scratch folder is under the system temp folder), and that CLI may write its
 * own state into the home; a home that is not signed in starts no CLI session at all.
 */
import { stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodingProvider } from "../../src/shared/coding-cli.ts";
import { EngineId } from "../../src/shared/providers.ts";
import { DEFAULT_MAX_QUOTA_PERCENT, engineQuotaReader, type QuotaReader, windowsOver } from "./budget.ts";
import { type CliResolver, defaultHostSkillsDir, hostSkillPaths, resolveLaneCli } from "./lanes/argv.ts";
import { checkWorkspaceAncestors } from "./lanes/common.ts";
import {
  applyEvalHomesEnv,
  EvalHomesError,
  evalHomesRefusalLines,
  type EvalHomeStatus,
  type EvalsLayout,
  evalHomesStatus,
  evalsLayout,
  evalsRoot,
} from "./lanes/homes.ts";
import { CheckResult } from "./vocabulary.ts";

/** The Node major every eval command needs (`.nvmrc`). */
const REQUIRED_NODE_MAJOR = 24;
/** Free disk a campaign needs: app builds, snapshots and evidence. */
export const MIN_FREE_DISK_BYTES = 20 * 1024 ** 3;
/** The quota session's scratch folder, under the system temp folder so doctor adds nothing to the evals home. */
const DOCTOR_QUOTA_CWD = "genex-evals-doctor-quota";
/** The exit code when any check failed. */
export const DOCTOR_EXIT_FAILED = 1;

/** The checks `doctor` runs, in order. */
export const DoctorCheck = {
  Node: "node",
  Cli: "cli",
  HomeAuth: "home-auth",
  HostSkills: "host-skills",
  Chromium: "chromium",
  Disk: "disk",
  EvalsHome: "evals-home",
  HomeEnv: "home-env",
  Quota: "quota",
} as const;
export type DoctorCheck = (typeof DoctorCheck)[keyof typeof DoctorCheck];

/** One check's result; `detail` and `items` are for the terminal only. */
export interface DoctorResult {
  check: DoctorCheck;
  engine: CodingProvider | null;
  result: CheckResult;
  detail: string;
  items: string[];
}

/** What `doctor` reads; every part is injectable. */
export interface DoctorDeps {
  nodeVersion: string;
  layout: EvalsLayout;
  home: string;
  resolveCli: CliResolver;
  homesStatus: (layout: EvalsLayout) => Promise<EvalHomeStatus[]>;
  hostSkillsDir: string;
  /** Playwright's Chromium executable path, or null when Playwright cannot name one. */
  chromiumPath: () => Promise<string | null>;
  /** Free bytes on the volume holding the path, or null when unknown. */
  freeBytes: (dir: string) => Promise<number | null>;
  readQuota: QuotaReader;
  maxQuotaPercent: number;
  /** The environment the engines read their homes from; the home-env check points it at the eval homes. */
  env: NodeJS.ProcessEnv;
}

const ENGINES: readonly CodingProvider[] = [EngineId.ClaudeCode, EngineId.Codex];

const result = (
  check: DoctorCheck,
  outcome: CheckResult,
  detail: string,
  extra: { engine?: CodingProvider; items?: string[] } = {},
): DoctorResult => ({ check, engine: extra.engine ?? null, result: outcome, detail, items: extra.items ?? [] });

/** Node's major version is the pinned one. */
function nodeCheck(version: string): DoctorResult {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  const ok = major === REQUIRED_NODE_MAJOR;
  return result(DoctorCheck.Node, ok ? CheckResult.Pass : CheckResult.Fail, `node ${version}`);
}

/** Each CLI is found by the app's discovery and reports its version. */
async function cliChecks(resolve: CliResolver): Promise<DoctorResult[]> {
  return Promise.all(
    ENGINES.map(async (engine) => {
      try {
        const cli = await resolve(engine);
        return result(DoctorCheck.Cli, CheckResult.Pass, `${cli.path} ${cli.version ?? "(no version)"}`, { engine });
      } catch (error) {
        return result(DoctorCheck.Cli, CheckResult.Fail, (error as Error).message, { engine });
      }
    }),
  );
}

/** Each eval home is signed in with a subscription; a Codex API-key login is refused. */
function authResult(status: EvalHomeStatus): DoctorResult {
  const engine = status.engine;
  if (status.loggedIn === null) return result(DoctorCheck.HomeAuth, CheckResult.Unknown, status.home, { engine });
  if (!status.loggedIn) return result(DoctorCheck.HomeAuth, CheckResult.Fail, `signed out: ${status.home}`, { engine });
  if (status.apiKeyLogin)
    return result(DoctorCheck.HomeAuth, CheckResult.Fail, `API-key login: ${status.home}`, { engine });
  return result(DoctorCheck.HomeAuth, CheckResult.Pass, status.home, { engine });
}

/** The host skills raw Codex will disable per path. */
async function hostSkillsCheck(dir: string): Promise<DoctorResult> {
  const skills = await hostSkillPaths(dir);
  return result(DoctorCheck.HostSkills, CheckResult.Pass, `${skills.length} host skills disabled per path`, {
    items: skills,
  });
}

/** Playwright's Chromium is already installed; doctor never downloads it. */
async function chromiumCheck(chromiumPath: () => Promise<string | null>): Promise<DoctorResult> {
  const file = await chromiumPath().catch(() => null);
  const present = file ? Boolean(await stat(file).catch(() => null)) : false;
  const detail = file ?? "Playwright named no Chromium";
  return result(DoctorCheck.Chromium, present ? CheckResult.Pass : CheckResult.Fail, detail);
}

/** The nearest existing folder at or above `dir`. */
async function nearestExisting(dir: string): Promise<string> {
  let at = dir;
  while (!(await stat(at).catch(() => null)) && path.dirname(at) !== at) at = path.dirname(at);
  return at;
}

/** Enough free disk under the evals home. */
async function diskCheck(root: string, freeBytes: (dir: string) => Promise<number | null>): Promise<DoctorResult> {
  const free = await freeBytes(await nearestExisting(root)).catch(() => null);
  if (free === null) return result(DoctorCheck.Disk, CheckResult.Unknown, root);
  const gib = (free / 1024 ** 3).toFixed(1);
  return result(DoctorCheck.Disk, free >= MIN_FREE_DISK_BYTES ? CheckResult.Pass : CheckResult.Fail, `${gib} GiB free`);
}

/** The evals home is outside any repository and below no instruction file. */
async function evalsHomeCheck(root: string, home: string): Promise<DoctorResult> {
  const check = await checkWorkspaceAncestors(root, home);
  if (check.ok) return result(DoctorCheck.EvalsHome, CheckResult.Pass, root);
  return result(DoctorCheck.EvalsHome, CheckResult.Fail, `${check.refusal}: ${check.at}`);
}

/**
 * Point the engines at the eval homes, as `campaign run` and grading do: a `CLAUDE_CONFIG_DIR` or
 * `CODEX_HOME` naming another home fails with the same refusal line, and nothing is applied.
 */
function homeEnvCheck(homes: EvalsLayout["homes"], env: NodeJS.ProcessEnv): DoctorResult {
  try {
    applyEvalHomesEnv(homes, env);
  } catch (error) {
    if (!(error instanceof EvalHomesError)) throw error;
    const [line = "", ...rest] = evalHomesRefusalLines(error);
    return result(DoctorCheck.HomeEnv, CheckResult.Fail, line, { items: rest });
  }
  return result(DoctorCheck.HomeEnv, CheckResult.Pass, "CLAUDE_CONFIG_DIR and CODEX_HOME name the eval homes");
}

/**
 * Each signed-in provider's quota windows against the ceiling; unreadable quota is unknown, never
 * zero. A home that is not signed in is unknown and its CLI is never started.
 */
async function quotaChecks(
  read: QuotaReader,
  maxPercent: number,
  signedIn: ReadonlySet<CodingProvider>,
): Promise<DoctorResult[]> {
  return Promise.all(
    ENGINES.map(async (engine) => {
      if (!signedIn.has(engine)) return result(DoctorCheck.Quota, CheckResult.Unknown, "not signed in", { engine });
      const usage = await read(engine).catch(() => null);
      if (!usage) return result(DoctorCheck.Quota, CheckResult.Unknown, "quota unreadable", { engine });
      const items = usage.windows.map(
        (w) => `${w.id} ${w.percent ?? "?"}%${w.resetsAt ? ` resets ${w.resetsAt}` : ""}`,
      );
      const over = windowsOver(usage, maxPercent).length > 0;
      const detail = over ? `above ${maxPercent}%` : `under ${maxPercent}%`;
      return result(DoctorCheck.Quota, over ? CheckResult.Fail : CheckResult.Pass, detail, { engine, items });
    }),
  );
}

/** Every doctor check, in order. */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult[]> {
  const homes = await deps.homesStatus(deps.layout);
  const signedIn = new Set(homes.filter((status) => status.loggedIn === true).map((status) => status.engine));
  return [
    nodeCheck(deps.nodeVersion),
    ...(await cliChecks(deps.resolveCli)),
    ...homes.map(authResult),
    await hostSkillsCheck(deps.hostSkillsDir),
    await chromiumCheck(deps.chromiumPath),
    await diskCheck(deps.layout.root, deps.freeBytes),
    await evalsHomeCheck(deps.layout.root, deps.home),
    homeEnvCheck(deps.layout.homes, deps.env),
    ...(await quotaChecks(deps.readQuota, deps.maxQuotaPercent, signedIn)),
  ];
}

/** The report as terminal lines. */
export function formatDoctor(results: readonly DoctorResult[]): string {
  return results
    .flatMap((row) => [
      `${row.result.padEnd(7)} ${row.check}${row.engine ? ` (${row.engine})` : ""}: ${row.detail}`,
      ...row.items.map((item) => `          ${item}`),
    ])
    .join("\n");
}

/** 0 when no check failed; unknown is reported but does not fail. */
export function doctorExitCode(results: readonly DoctorResult[]): number {
  return results.some((row) => row.result === CheckResult.Fail) ? DOCTOR_EXIT_FAILED : 0;
}

/** Playwright's own idea of its Chromium, without downloading anything. */
async function playwrightChromiumPath(): Promise<string | null> {
  const { chromium } = await import("@playwright/test");
  return chromium.executablePath() || null;
}

/** The machine's own doctor dependencies. */
export function systemDoctorDeps(env: NodeJS.ProcessEnv = process.env): DoctorDeps {
  const home = os.homedir();
  const layout = evalsLayout(evalsRoot(env, home));
  return {
    nodeVersion: process.version,
    layout,
    home,
    resolveCli: resolveLaneCli,
    homesStatus: (at) => evalHomesStatus(at.homes),
    hostSkillsDir: defaultHostSkillsDir(home),
    chromiumPath: playwrightChromiumPath,
    freeBytes: async (dir) => {
      const info = await statfs(dir);
      return info.bavail * info.bsize;
    },
    readQuota: engineQuotaReader(layout, env, path.join(os.tmpdir(), DOCTOR_QUOTA_CWD)),
    maxQuotaPercent: DEFAULT_MAX_QUOTA_PERCENT,
    env,
  };
}

/**
 * The `doctor` command handler for `scripts/eval.ts`. The home-env check points this process's
 * engines at the eval homes, so quota is read from those accounts; a home variable that names
 * another home fails that check (quota then reads unknown).
 */
export async function doctorCommand(
  _args: readonly string[],
  out: (line: string) => void = console.log,
  given?: DoctorDeps,
): Promise<number> {
  const deps = given ?? systemDoctorDeps();
  const results = await runDoctor(deps);
  out(formatDoctor(results));
  return doctorExitCode(results);
}
