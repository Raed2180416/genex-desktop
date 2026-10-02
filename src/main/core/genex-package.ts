/**
 * `genex__package`: the bundled Genex plugin's consented install of one of its two SDK packages
 * into the game a call is bound to. The agent names the package; the version comes from
 * `GENEX_GAME_PACKAGES` and the command from the game's lockfile (`GameBuilds.addPackages`), and
 * the folder must be, by real path, the game's own or a Studio worktree git registers for it.
 */
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { InstallResult } from "../../shared/build-problem.ts";
import { GENEX_GAME_PACKAGES, isGenexGamePackage } from "../../shared/genex.ts";
import type { PluginBinding } from "../../shared/plugins.ts";
import { isBelow } from "../../substrate/paths.ts";
import { git } from "../../substrate/snapshots.ts";
import { GENEX_CLI_PROMPT } from "./genex-cli-prompts.ts";

const WORKTREE_LINE = "worktree ";

/** What an install needs from Studio. */
export interface GenexPackageDeps {
  /** `GameBuilds.addPackages`: the one command, with the registry opened for it alone. */
  addPackages: (source: { project: string; dir: string }, names: readonly string[]) => Promise<InstallResult>;
  /** The game's folder in the library; throws for a name that is not a game. */
  gameDir: (project: string) => string;
  /** Studio's scratch, where its worktrees of a game live. */
  scratch: string;
}

/** What the agent reads back after an install ran. */
export interface GenexPackageAnswer {
  package: string;
  version: string;
  ok: boolean;
  lines: string[];
}

/** The package a call names, checked against Studio's pins; anything else is refused. */
function genexPackageOf(args: Record<string, unknown>): keyof typeof GENEX_GAME_PACKAGES {
  const name = args.package;
  if (isGenexGamePackage(name)) return name;
  throw new Error(GENEX_CLI_PROMPT.UnknownPackage(String(name), Object.keys(GENEX_GAME_PACKAGES)));
}

/** Multiplayer needs player identity too; one explicit approval covers the complete prerequisite. */
function packageSet(name: keyof typeof GENEX_GAME_PACKAGES): Array<keyof typeof GENEX_GAME_PACKAGES> {
  return name === "@genex-ai/multiplayer" ? [name, "@genex-ai/embed-sdk"] : [name];
}

/** What the consent card shows for a `genex__package` call: the package and the version Studio pins. */
export function genexPackageConsentArgs(args: Record<string, unknown>): { package: string; version: string } {
  const name = genexPackageOf(args);
  return {
    package: packageSet(name).join(", "),
    version: packageSet(name)
      .map((item) => GENEX_GAME_PACKAGES[item])
      .join(", "),
  };
}

/** Adds a pinned Genex SDK package to the game a call is bound to, and nowhere else. */
export class GenexPackageService {
  readonly #deps: GenexPackageDeps;
  constructor(deps: GenexPackageDeps) {
    this.#deps = deps;
  }

  /** Check the package and the folder, then run the install; nothing runs when either is refused. */
  async add(args: Record<string, unknown>, binding: PluginBinding): Promise<GenexPackageAnswer> {
    const name = genexPackageOf(args);
    const dir = await this.preflight(args, binding);
    const result = await this.#deps.addPackages({ project: binding.project, dir }, packageSet(name));
    return { package: name, version: GENEX_GAME_PACKAGES[name], ...result };
  }

  /** Refuse unsupported or foreign folders before asking for installation approval. No process is started. */
  async preflight(args: Record<string, unknown>, binding: PluginBinding): Promise<string> {
    genexPackageOf(args);
    const dir = await this.#boundFolder(binding);
    const manifest = await stat(path.join(dir, "package.json")).catch(() => null);
    if (!manifest?.isFile()) throw new Error(GENEX_CLI_PROMPT.NoPackageJson);
    return dir;
  }

  /** The binding's folder by real path: the game's own, or a worktree of it under Studio's scratch. */
  async #boundFolder(binding: PluginBinding): Promise<string> {
    const game = await this.#gameFolder(binding.project);
    const real = await realpath(binding.directory).catch(() => null);
    if (real && game && (real === game || (await this.#isWorktreeOf(game, real)))) return real;
    throw new Error(GENEX_CLI_PROMPT.ForeignFolder);
  }

  async #gameFolder(project: string): Promise<string | null> {
    try {
      return await realpath(this.#deps.gameDir(project));
    } catch {
      return null;
    }
  }

  /** Whether git lists `dir` as a worktree of `game`, and it lies under Studio's scratch. */
  async #isWorktreeOf(game: string, dir: string): Promise<boolean> {
    const scratch = await realpath(this.#deps.scratch).catch(() => null);
    if (!scratch || !isBelow(scratch, dir)) return false;
    const listing = await git(game, ["worktree", "list", "--porcelain"]).catch(() => "");
    const worktrees = listing.split("\n").filter((line) => line.startsWith(WORKTREE_LINE));
    const real = await Promise.all(worktrees.map((line) => realpath(line.slice(WORKTREE_LINE.length)).catch(() => "")));
    return real.includes(dir);
  }
}
