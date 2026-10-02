import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { requireCodingCli } from "../../src/substrate/engines/external-cli.ts";
export const fixtureCodingCli: typeof requireCodingCli = async (provider) => ({
  path: "/fixture/external/claude",
  env: { PATH: "/fixture/runtime:/usr/bin:/bin" },
  status: {
    provider,
    state: "ready",
    selection: "automatic",
    path: "/fixture/external/claude",
    version: "fixture-1",
    detail: "Test fixture",
    guidanceUrl: "",
  },
});

const WINDOWS = process.platform === "win32";

/** A fixture CLI's file name on this host: npm's `.cmd` shim on Windows, the bare name elsewhere. */
export const cliName = (name: string): string => (WINDOWS ? `${name}.cmd` : name);

/**
 * Write a fixture CLI launcher at `file` (named with `cliName`): the POSIX text as it is, executable,
 * or on Windows a `.cmd` that runs `js` (saved beside it as `.js`) under this Node.
 */
export async function writeCliLauncher(file: string, posix: string, js: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  if (!WINDOWS) {
    await writeFile(file, posix, { mode: 0o755 });
    await chmod(file, 0o755);
    return;
  }
  const script = file.replace(/\.cmd$/i, ".js");
  await writeFile(script, js);
  await writeFile(file, `@"${process.execPath}" "${script}" %*\r\n`);
}

/**
 * Whether a child was stopped rather than left running: by a signal on macOS and Linux; Windows has
 * no signals, and `taskkill /F` ends a tree with an exit code instead.
 */
export function wasStopped(child: { exitCode: number | null; signalCode: NodeJS.Signals | null }): boolean {
  return WINDOWS ? child.exitCode !== null : child.signalCode !== null;
}
