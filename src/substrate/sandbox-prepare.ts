import { constants } from "node:fs";
import { access } from "node:fs/promises";

/** The shell srt wraps commands in on macOS. */
const SANDBOX_SHELL = "/bin/bash";
/**
 * sandbox-runtime's own words when its lookup of the shell times out. srt gives no error code,
 * so its message is the only way to tell this flake from a real failure.
 */
const SRT_SHELL_NOT_FOUND = `Shell '${SANDBOX_SHELL}' not found in PATH`;
/** Preparation attempts before a shell that exists but cannot be resolved is reported. */
const MAX_PREPARE_ATTEMPTS = 3;

const MESSAGE = {
  LookupFailed: `Sandbox shell lookup failed after three preparation attempts; ${SANDBOX_SHELL} is executable but sandbox-runtime could not resolve it. No command was started.`,
} as const;

/** SRT's Node executable lookup runs `which` with a one-second deadline. Under load it
 * reports an installed shell as missing. Retry only preparation, before any child exists;
 * never retry the caller's command, weaken its policy, or ignore cancellation. */
export async function prepareSandbox<T>(
  prepare: () => Promise<T>,
  options: { signal?: AbortSignal; platform?: string; checkShell?: () => Promise<void> } = {},
): Promise<T> {
  const checkShell = options.checkShell ?? (() => access(SANDBOX_SHELL, constants.X_OK));
  const platform = options.platform ?? process.platform;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const result = await prepare();
      options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!isShellLookupFlake(platform, error)) throw error;
      // A genuinely absent/inaccessible executable is not a transient lookup failure.
      await checkShell();
      if (attempt >= MAX_PREPARE_ATTEMPTS - 1) throw new Error(MESSAGE.LookupFailed, { cause: error });
    }
  }
}

/** srt's shell lookup timed out on macOS: the one failure preparation is retried for. */
function isShellLookupFlake(platform: string, error: unknown): boolean {
  return platform === "darwin" && error instanceof Error && error.message === SRT_SHELL_NOT_FOUND;
}
