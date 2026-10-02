/** Whether a process is still running, for tests that prove a stop left nothing behind. */
import { spawnSync } from "node:child_process";

/** How `ps` marks a process that has exited but is not reaped yet. */
const ZOMBIE_STATE = "Z";

/**
 * Whether `pid` is still running: in the process table and not a zombie. `kill(pid, 0)` cannot
 * tell, as it also succeeds for a process that has exited but is not reaped yet. A stopped job's
 * descendant is reaped by launchd, because the job, its parent, stopped with it, and on a busy
 * machine a check can come first. POSIX only.
 */
export function running(pid: number): boolean {
  const ps = spawnSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  if (ps.error) throw ps.error;
  const state = ps.stdout.trim();
  return state !== "" && !state.startsWith(ZOMBIE_STATE);
}
