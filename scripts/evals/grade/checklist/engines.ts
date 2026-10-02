/**
 * The app's own engines, built for grading (§8.4): the same toolless, contained `complete()` the
 * app's judges use, signed in only through the eval-owned CLI homes (§5.4). Both the engine home and
 * the fallback "system" home are the eval home, so a grader can never reach the operator's own
 * `~/.claude` or `~/.codex`; an environment that points either CLI at another home is refused.
 * Codex loads `~/.agents/skills` whatever `CODEX_HOME` says (Rule 7), so the Codex grader runs with
 * the eval lane's host-skill suppression (`HostSkills.Suppress`): every host skill disabled by path
 * and the desktop/browser features off, on every `codex exec` including `complete()`.
 */
import path from "node:path";
import type { EvalCliHomes } from "../../../../src/shared/eval-lane.ts";
import { EngineId } from "../../../../src/shared/providers.ts";
import type { ClaudeCodeEngineOptions } from "../../../../src/substrate/engines/claude-code.ts";
import type { CodexEngineOptions } from "../../../../src/substrate/engines/codex.ts";
import type { CompletingEngine } from "./complete.ts";

/** The environment variable each CLI reads its home from; set by the eval process, never by a grader. */
const HOME_ENV: Readonly<Record<keyof EvalCliHomes, string>> = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
};

/** Why grading engines were refused. */
export const GraderSetupProblem = {
  /** The environment names a CLI home that is not the eval home. */
  ForeignHome: "foreign-home",
} as const;
export type GraderSetupProblem = (typeof GraderSetupProblem)[keyof typeof GraderSetupProblem];

/** Grading engines were refused before any was built. */
export class GraderSetupError extends Error {
  readonly problem: GraderSetupProblem;
  constructor(problem: GraderSetupProblem) {
    super(`grading engines refused: ${problem}`);
    this.name = "GraderSetupError";
    this.problem = problem;
  }
}

/** How the grading engines are built. */
export interface GraderEngineOptions {
  homes: EvalCliHomes;
  /** An empty folder of the eval's own where every Claude judge session runs. */
  judgeCwd: string;
  /** The host-skills folder whose `SKILL.md` files every Codex grader call disables; unset = `~/.agents/skills`. */
  hostSkillsDir?: string;
  /** The environment to check; defaults to this process's. */
  env?: NodeJS.ProcessEnv;
  /** Test seams passed through to the engines (a scripted `queryFn`, `execFn`, CLI resolver). */
  claude?: Partial<ClaudeCodeEngineOptions>;
  codex?: Partial<CodexEngineOptions>;
}

/** Refuse an environment that points a CLI at a home other than the eval's. */
export function assertEvalHomes(homes: EvalCliHomes, env: NodeJS.ProcessEnv): void {
  for (const cli of Object.keys(HOME_ENV) as Array<keyof EvalCliHomes>) {
    const value = env[HOME_ENV[cli]];
    if (value !== undefined && path.resolve(value) !== path.resolve(homes[cli]))
      throw new GraderSetupError(GraderSetupProblem.ForeignHome);
  }
}

/** Build one engine per grader family, in the eval homes. Engines load lazily: tests never pay for the SDK. */
export async function createGraderEngines(
  options: GraderEngineOptions,
): Promise<Partial<Record<EngineId, CompletingEngine>>> {
  assertEvalHomes(options.homes, options.env ?? process.env);
  const [{ ClaudeCodeEngine }, { CodexEngine, HostSkills }] = await Promise.all([
    import("../../../../src/substrate/engines/claude-code.ts"),
    import("../../../../src/substrate/engines/codex.ts"),
  ]);
  return {
    [EngineId.ClaudeCode]: new ClaudeCodeEngine({
      ...options.claude,
      engineHome: options.homes.claude,
      systemHome: options.homes.claude,
      judgeCwd: options.judgeCwd,
      sweepOnBoot: false,
    }),
    [EngineId.Codex]: new CodexEngine({
      ...options.codex,
      engineHome: options.homes.codex,
      systemHome: options.homes.codex,
      hostSkills: HostSkills.Suppress,
      ...(options.hostSkillsDir === undefined ? {} : { hostSkillsDir: options.hostSkillsDir }),
    }),
  };
}
