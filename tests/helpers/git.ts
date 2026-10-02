import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";
import { startWithRecovery } from "../../src/substrate/process-start.ts";

const execute = promisify(execFile);

/** Real fixture Git with the same pre-start admission handling as Studio.
 * Keep the caller's environment/config; do not substitute Studio's committer. */
export function gitFile(args: string[], options: ExecFileOptions = {}) {
  return startWithRecovery(() => execute("git", args, { ...options, encoding: "utf8" }));
}
