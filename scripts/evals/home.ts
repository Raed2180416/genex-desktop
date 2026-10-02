/**
 * The evals home (§9.2, D1): `$GENEX_EVALS_HOME` when set, else `~/.genex-evals`, outside any
 * checkout so it survives worktrees and supports regrades. The one place its variable, its default
 * folder and its resolution rule are spelled: the ledger, the lanes, the prober's lock, the key file
 * and the anti-fitting checker all read the home through here. Node's `os` and `path` only, so the
 * static checker can load it cheaply.
 */
import os from "node:os";
import path from "node:path";

/** The environment variable that moves the evals home. */
export const EVALS_HOME_ENV = "GENEX_EVALS_HOME";
/** The evals home's folder name under the user's home when the variable is unset. */
export const DEFAULT_EVALS_HOME_NAME = ".genex-evals";

/** A path the evals home refuses to resolve (a relative override, a hostile runId). */
export class EvalsPathError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EvalsPathError";
  }
}

/** What the resolvers read, injectable for tests. */
export interface EvalsHomeSource {
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
}

/**
 * The home `$GENEX_EVALS_HOME` names, or null when it is unset or empty. A relative path or one
 * holding a NUL byte is refused (`EvalsPathError`), never resolved against the working folder.
 */
export function configuredEvalsHome(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const override = env[EVALS_HOME_ENV];
  if (!override) return null;
  if (!path.isAbsolute(override) || override.includes("\0"))
    throw new EvalsPathError(`${EVALS_HOME_ENV} must be an absolute path`);
  return path.resolve(override);
}

/** `$GENEX_EVALS_HOME` when set (it must be absolute), else `~/.genex-evals`. */
export function resolveEvalsHome({ env = process.env, home = os.homedir() }: EvalsHomeSource = {}): string {
  return configuredEvalsHome(env) ?? path.join(home, DEFAULT_EVALS_HOME_NAME);
}
