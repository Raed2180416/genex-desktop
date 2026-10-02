/**
 * Stopping a process together with everything it started.
 *
 * On macOS and Linux a child started `detached` leads its own process group, and one signal to the
 * group reaches the whole tree. Windows has no process groups or signals: `kill()` ends only the
 * process itself, so a CLI started through `cmd.exe` (see `command-launch.ts`) would leave its
 * Node running. There `taskkill /T /F` ends the tree by parent id.
 */
import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import { SECOND_MS } from "../shared/duration.ts";
import { envValue, isWindows } from "./toolchain.ts";

/** How long `taskkill` may take to end a tree. */
const TASKKILL_TIMEOUT_MS = 10 * SECOND_MS;

/** A program and its arguments, as `execFile` takes them. */
export interface TreeKillCommand {
  file: string;
  args: string[];
}

/** Windows: `taskkill` by its full path, ending `pid` and every descendant, forcibly. */
export function treeKillCommand(pid: number, env: NodeJS.ProcessEnv = process.env): TreeKillCommand {
  const systemRoot = envValue(env, "SystemRoot") || "C:\\Windows";
  return {
    file: path.win32.join(systemRoot, "System32", "taskkill.exe"),
    args: ["/PID", String(pid), "/T", "/F"],
  };
}

/** Run a command to its end, whatever it answers: a tree already gone is not an error. */
function runQuietly(command: TreeKillCommand): Promise<void> {
  return new Promise((resolve) => {
    execFile(command.file, command.args, { timeout: TASKKILL_TIMEOUT_MS, windowsHide: true }, () => resolve());
  });
}

export interface KillTreeOptions {
  platform?: NodeJS.Platform;
  /** The POSIX signal; Windows always ends the tree forcibly. */
  signal?: NodeJS.Signals;
  env?: NodeJS.ProcessEnv;
  /** Windows: runs `taskkill`. Injectable for tests. */
  run?: (command: TreeKillCommand) => Promise<void>;
  /** POSIX: sends a signal (`process.kill`). Injectable for tests. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

/**
 * End `pid` and its descendants. POSIX signals the process group `pid` leads, or `pid` alone when
 * it leads none; Windows runs `taskkill /T /F`. Never throws: a process already gone is the goal.
 */
export async function killProcessTree(pid: number | undefined, options: KillTreeOptions = {}): Promise<void> {
  if (!pid) return;
  const platform = options.platform ?? process.platform;
  if (isWindows(platform)) {
    await (options.run ?? runQuietly)(treeKillCommand(pid, options.env));
    return;
  }
  const kill = options.kill ?? ((target: number, signal: NodeJS.Signals) => process.kill(target, signal));
  const signal = options.signal ?? "SIGKILL";
  try {
    kill(-pid, signal);
  } catch {
    try {
      kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Stop a child the way its platform can: on macOS and Linux `kill(signal)` to the child itself, as
 * ever; on Windows `taskkill /T /F`, because a CLI started through cmd.exe runs one level down.
 * Nothing happens once the child has exited, so a reused process id is never hit.
 */
export async function stopChild(
  child: Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "kill">,
  options: KillTreeOptions = {},
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows(options.platform ?? process.platform)) {
    await killProcessTree(child.pid, options);
    return;
  }
  child.kill(options.signal ?? "SIGKILL");
}
