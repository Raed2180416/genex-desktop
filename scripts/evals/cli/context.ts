/**
 * What the CLI-owned commands (cases, report, compare, check, baseline promote, ledger export,
 * validate-ledger, gc) read and write: the evals home, the repository (cases, lane registry,
 * committed baselines and exports), a clock and the JSON formatter. `systemCliContext` binds the
 * machine's own; tests pass a temp home, a temp repository root and fakes.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { EvalCase } from "../case-types.ts";
import { readCases, readHoldoutCases } from "../cases.ts";
import { resolveEvalsHome } from "../home.ts";
import { defaultLanesRoot } from "../lanes/common.ts";
import { readLaneRegistry } from "../lanes/registry.ts";
import type { LaneRegistry } from "../lanes/types.ts";
import { type EvalsPaths, evalsPaths } from "../ledger/paths.ts";

const run = promisify(execFile);

/** The repository these scripts ship in. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
/** Biome, as the repository pins it. */
const BIOME_BIN = path.join("node_modules", ".bin", "biome");

/** Everything a CLI-owned command reads from outside. */
export interface CliContext {
  paths: EvalsPaths;
  /** The repository whose `evals/` holds the cases, the lane registry, baselines and exports. */
  root: string;
  /** The running lanes' folder outside the evals home (`defaultLanesRoot()`), whose leftovers `gc` sweeps. */
  lanes: string;
  /** Public cases and, when the private file exists, the holdouts. */
  cases: () => EvalCase[];
  registry: () => LaneRegistry;
  now: () => Date;
  /** Format written JSON files in place (`biome format --write`); rejects when the formatter fails. */
  formatJson: (files: readonly string[]) => Promise<void>;
}

/** `biome format --write` over `files`, run from `root` so its configuration applies. */
export function biomeFormatter(root: string): CliContext["formatJson"] {
  return async (files) => {
    if (files.length === 0) return;
    await run(path.join(root, BIOME_BIN), ["format", "--write", ...files], { cwd: root });
  };
}

/** The machine's own context: `$GENEX_EVALS_HOME`, this repository and the wall clock. */
export function systemCliContext(env: NodeJS.ProcessEnv = process.env): CliContext {
  const home = resolveEvalsHome({ env });
  return {
    paths: evalsPaths(home),
    root: REPO_ROOT,
    lanes: defaultLanesRoot(),
    cases: () => [...readCases(REPO_ROOT), ...readHoldoutCases(home)],
    registry: () => readLaneRegistry(REPO_ROOT),
    now: () => new Date(),
    formatJson: biomeFormatter(REPO_ROOT),
  };
}
