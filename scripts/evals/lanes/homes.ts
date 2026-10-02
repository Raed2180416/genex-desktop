/**
 * The eval-owned folders (§5.4, §9.2): `$GENEX_EVALS_HOME` (default `~/.genex-evals`) holds the
 * CLI homes the operator signs into once, the run workspaces, the app builds, the pinned files,
 * the evidence and the ledger. Sign-in state is asked of the CLIs themselves through the app's
 * `claudeAuthStatus`/`codexAuthStatus`: status only, never a credential file.
 */
import os from "node:os";
import path from "node:path";
import { claudeAuthStatus } from "../../../src/substrate/engines/claude-cli.ts";
import { codexAuthStatus } from "../../../src/substrate/engines/codex-cli.ts";
import { codingCliBinary } from "../../../src/substrate/engines/external-cli.ts";
import type { CodingProvider } from "../../../src/shared/coding-cli.ts";
import type { EvalCliHomes } from "../../../src/shared/eval-lane.ts";
import { EngineId } from "../../../src/shared/providers.ts";
import { resolveEvalsHome } from "../home.ts";
import { RUN_ID_PATTERN } from "../ledger/types.ts";
import { defaultLanesRoot } from "./common.ts";

/** The folder holding one CLI home per coding CLI, each named as the CLI installs itself. */
const HOMES_DIR = "homes";

/** Every eval-owned folder, by role. */
export interface EvalsLayout {
  root: string;
  homes: EvalCliHomes;
  /** Run workspaces, one per run id: each run's bookkeeping, and what its agent made once it ends. */
  work: string;
  /**
   * Where each running lane's agent works, outside the evals home (`defaultLanesRoot()`, under the
   * system temp folder); the scheduler moves what it made into `work/<runId>` when the run ends.
   */
  lanes: string;
  /** Eval-owned app builds, one per SHA. */
  builds: string;
  /** Pinned inputs the lanes read (the empty MCP config). */
  pinned: string;
  evidence: string;
  ledger: string;
}

/** The evals home: `$GENEX_EVALS_HOME` when set (it must be absolute), else `~/.genex-evals`. */
export function evalsRoot(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return resolveEvalsHome({ env, home });
}

/** The eval-owned folders under a root, with the running lanes' folder elsewhere (`lanes`). */
export function evalsLayout(root: string, lanes: string = defaultLanesRoot()): EvalsLayout {
  return {
    root,
    homes: {
      claude: path.join(root, HOMES_DIR, codingCliBinary(EngineId.ClaudeCode)),
      codex: path.join(root, HOMES_DIR, codingCliBinary(EngineId.Codex)),
    },
    work: path.join(root, "work"),
    lanes,
    builds: path.join(root, "builds"),
    pinned: path.join(root, "pinned"),
    evidence: path.join(root, "evidence"),
    ledger: path.join(root, "ledger"),
  };
}

/** A run's own work root, `work/<runId>`; a run id that is not one is refused before it names a path. */
export function runWorkRoot(layout: EvalsLayout, runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("not a run id");
  return path.join(layout.work, runId);
}

/** Why this process cannot be pointed at the eval homes. */
export const EvalHomesRefusal = {
  /** `CLAUDE_CONFIG_DIR` or `CODEX_HOME` already names another home, which the engines would read first. */
  OtherHome: "other-cli-home",
} as const;
export type EvalHomesRefusal = (typeof EvalHomesRefusal)[keyof typeof EvalHomesRefusal];

/** A refused `applyEvalHomesEnv`: the variable naming another home, and the eval home it should name. */
export class EvalHomesError extends Error {
  readonly code: EvalHomesRefusal;
  readonly variable: string;
  readonly wanted: string;
  constructor(variable: string, wanted: string) {
    super(`${EvalHomesRefusal.OtherHome}: ${variable}`);
    this.name = "EvalHomesError";
    this.code = EvalHomesRefusal.OtherHome;
    this.variable = variable;
    this.wanted = wanted;
  }
}

/** What a command prints for the refusal: the typed refusal, then how to run again. */
export function evalHomesRefusalLines(error: EvalHomesError): string[] {
  return [
    `refused ${error.code} ${error.variable}`,
    `usage: unset ${error.variable} (or set it to ${error.wanted}) and run again`,
  ];
}

/**
 * Point this process's engines at the eval homes. Engines read `CLAUDE_CONFIG_DIR`/`CODEX_HOME`
 * first, so a value that names another home is refused (`EvalHomesError`) rather than overwritten,
 * before either variable is set.
 */
export function applyEvalHomesEnv(homes: EvalCliHomes, env: NodeJS.ProcessEnv = process.env): void {
  const wanted = { CLAUDE_CONFIG_DIR: homes.claude, CODEX_HOME: homes.codex };
  for (const [name, value] of Object.entries(wanted)) {
    const current = env[name];
    if (current && path.resolve(current) !== path.resolve(value)) throw new EvalHomesError(name, value);
  }
  Object.assign(env, wanted);
}

/** Whether this process's home variables point at the eval homes. */
export function usesEvalHomes(homes: EvalCliHomes, env: NodeJS.ProcessEnv = process.env): boolean {
  const same = (value: string | undefined, home: string) => Boolean(value) && path.resolve(value ?? "") === home;
  return same(env.CLAUDE_CONFIG_DIR, homes.claude) && same(env.CODEX_HOME, homes.codex);
}

/** One eval home's sign-in state, as its CLI reports it. */
export interface EvalHomeStatus {
  engine: CodingProvider;
  home: string;
  /** `null`: the CLI could not be asked, which is not "signed out". */
  loggedIn: boolean | null;
  /** Codex signed in with an API key: a metered bill, refused for eval lanes. */
  apiKeyLogin: boolean;
}

/** The sign-in questions, injectable; the defaults ask the installed CLIs. */
export interface HomeStatusDeps {
  claude?: (home: string) => Promise<{ loggedIn: boolean | null }>;
  codex?: (home: string) => Promise<{ loggedIn: boolean | null; method?: string }>;
}

/** Both eval homes' sign-in state. Only the CLIs' status commands run; no credential is read. */
export async function evalHomesStatus(homes: EvalCliHomes, deps: HomeStatusDeps = {}): Promise<EvalHomeStatus[]> {
  const claude = await (deps.claude ?? ((home) => claudeAuthStatus(home)))(homes.claude);
  const codex = await (deps.codex ?? ((home) => codexAuthStatus(home)))(homes.codex);
  return [
    { engine: EngineId.ClaudeCode, home: homes.claude, loggedIn: claude.loggedIn, apiKeyLogin: false },
    { engine: EngineId.Codex, home: homes.codex, loggedIn: codex.loggedIn, apiKeyLogin: codex.method === "api_key" },
  ];
}
