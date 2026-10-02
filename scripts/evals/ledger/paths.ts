/**
 * Where eval data lives (§9.2): `$GENEX_EVALS_HOME` (default `~/.genex-evals`), outside any
 * checkout so it survives worktrees and supports regrades. Beneath it: `ledger/` (the three JSONL
 * files), `evidence/<runId>/`, `work/` (run folders, and the snapshot server's `grade-copies/`,
 * `npm-cache/` and `sandbox-scratch/`, which grading and the campaign's canary share), `builds/`,
 * `homes/` (eval-owned CLI homes), `secrets/` and `campaigns/<campaignId>/` (each campaign's plan).
 * A run's evidence folder can be overridden, as `scripts/test-evidence.mjs` lets acceptance
 * runners do. The two write boundaries live here too, both judged on the real path (links
 * followed): nothing is written inside the studio's or an engine's own home (the census's
 * `refuseOwnedOutput`), and `insideGitWorktree` tells the writer where holdouts may not go.
 */
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { type Homes, refuseOwnedOutput } from "../../transcript-census.ts";
import { EvalsPathError } from "../home.ts";
import { HUMAN_ROW_SCHEMA, type LedgerRow, PAIRWISE_ROW_SCHEMA, RUN_ID_PATTERN, RUN_ROW_SCHEMA } from "./types.ts";

// The home itself (its variable, default folder and resolver) is `../home.ts`'s; re-exported for the ledger's callers.
export {
  DEFAULT_EVALS_HOME_NAME,
  EVALS_HOME_ENV,
  type EvalsHomeSource,
  EvalsPathError,
  resolveEvalsHome,
} from "../home.ts";

/** The ledger's three append-only files, by the row schema each one holds. */
export const LEDGER_FILE_NAMES: Readonly<Record<LedgerRow["schema"], string>> = {
  [RUN_ROW_SCHEMA]: "runs.jsonl",
  [PAIRWISE_ROW_SCHEMA]: "pairwise.jsonl",
  [HUMAN_ROW_SCHEMA]: "human.jsonl",
};

/** Every folder and ledger file under one evals home, all absolute. */
export interface EvalsPaths {
  home: string;
  ledger: string;
  evidence: string;
  work: string;
  builds: string;
  homes: string;
  secrets: string;
  /** One folder per campaign, holding its `campaign.json`. */
  campaigns: string;
  /** The snapshot server's copies (one per snapshot path), rebuilt inside the sandbox; grading and the canary share them. */
  serveCopies: string;
  /** The npm cache the sandboxed copy builds read and write: the sandbox's only standing write grant. */
  npmCache: string;
  /** The copy-build sandbox's own scratch (its `TMPDIR`). */
  sandboxScratch: string;
  ledgerFiles: { runs: string; pairwise: string; human: string };
}

/** The layout beneath an evals home. */
export function evalsPaths(home: string): EvalsPaths {
  const root = path.resolve(home);
  const ledger = path.join(root, "ledger");
  const work = path.join(root, "work");
  return {
    home: root,
    ledger,
    evidence: path.join(root, "evidence"),
    work,
    builds: path.join(root, "builds"),
    homes: path.join(root, "homes"),
    secrets: path.join(root, "secrets"),
    campaigns: path.join(root, "campaigns"),
    serveCopies: path.join(work, "grade-copies"),
    npmCache: path.join(work, "npm-cache"),
    sandboxScratch: path.join(work, "sandbox-scratch"),
    ledgerFiles: {
      runs: path.join(ledger, LEDGER_FILE_NAMES[RUN_ROW_SCHEMA]),
      pairwise: path.join(ledger, LEDGER_FILE_NAMES[PAIRWISE_ROW_SCHEMA]),
      human: path.join(ledger, LEDGER_FILE_NAMES[HUMAN_ROW_SCHEMA]),
    },
  };
}

/** The ledger file a row of this schema is appended to. */
export function ledgerFileFor(paths: EvalsPaths, schema: LedgerRow["schema"]): string {
  return path.join(paths.ledger, LEDGER_FILE_NAMES[schema]);
}

/** A run's evidence folder: `override` when given, else `evidence/<runId>` (the runId must match its pattern). */
export function evidenceDir(paths: EvalsPaths, runId: string, override?: string): string {
  if (override) return path.resolve(override);
  if (!RUN_ID_PATTERN.test(runId)) throw new EvalsPathError("evidence needs a well-formed runId");
  return path.join(paths.evidence, runId);
}

/** The real path of `target`, or of its nearest existing ancestor with the rest appended. */
export async function nearestRealPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  const rest: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Why writing `target` would land inside the studio's or an engine's own data, or null; judged lexically and on real paths. */
export async function refuseOwnedPath(target: string, homes: Homes): Promise<string | null> {
  const lexical = refuseOwnedOutput(path.resolve(target), homes);
  if (lexical) return lexical;
  return refuseOwnedOutput(await nearestRealPath(target), await realHomes(homes));
}

/** `homes` with each owned folder on its real path, so a link or `/private/var` spelling cannot slip past. */
async function realHomes(homes: Homes): Promise<Homes> {
  return {
    ...homes,
    appDir: await nearestRealPath(homes.appDir),
    legacyAppDir: homes.legacyAppDir ? await nearestRealPath(homes.legacyAppDir) : undefined,
    claudeIsolated: await nearestRealPath(homes.claudeIsolated),
    claudeSystem: await nearestRealPath(homes.claudeSystem),
    codexIsolated: await nearestRealPath(homes.codexIsolated),
    codexSystem: await nearestRealPath(homes.codexSystem),
  };
}

/** Whether `target`, on its real path, sits inside a Git working tree (some ancestor holds `.git`). */
export async function insideGitWorktree(target: string): Promise<boolean> {
  let current = await nearestRealPath(target);
  for (;;) {
    if (await exists(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}
