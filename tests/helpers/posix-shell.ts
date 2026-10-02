/**
 * The shell the harness's `run.exec` hands a command to: `/bin/sh` on macOS and Linux, Git Bash on
 * Windows (the Windows sandbox's shell, `findGitBash` in src/substrate/windows-sandbox.ts). Tests
 * that prove quoting on a real shell run through it, so they prove the shell each platform uses.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findGitBash } from "../../src/substrate/windows-sandbox.ts";

const execFileAsync = promisify(execFile);

let shell: Promise<string> | null = null;

/** The platform's POSIX shell; throws on Windows without Git for Windows. */
export function posixShell(): Promise<string> {
  shell ??= process.platform === "win32" ? gitBash() : Promise.resolve("/bin/sh");
  return shell;
}

async function gitBash(): Promise<string> {
  const bash = await findGitBash();
  if (!bash) throw new Error("Git for Windows' bash.exe was not found");
  return bash;
}

/** What one shell command did. */
export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `command` with `-c` in `cwd`, as `run.exec` does: the studio's isolated git config and, on
 * Windows, the env file's `MSYS_NO_PATHCONV=1`. A failing command resolves with its exit code.
 */
export async function shellExec(command: string, cwd: string): Promise<ShellResult> {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", MSYS_NO_PATHCONV: "1" };
  try {
    const { stdout, stderr } = await execFileAsync(await posixShell(), ["-c", command], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
