import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { realpathSync } from "node:fs";

const created: string[] = [];
const closers: Array<() => Promise<void>> = [];

/**
 * Temp dir that is removed when the test file finishes. On Windows it is spelled by its long
 * name, as the app's own folders are: `os.tmpdir()` can carry an 8.3 name (`RUNNER~1`).
 */
export async function tmpDir(prefix = "studio-test-"): Promise<string> {
  const made = await mkdtemp(path.join(os.tmpdir(), prefix));
  const dir = process.platform === "win32" ? realpathSync.native(made) : made;
  created.push(dir);
  return dir;
}

/**
 * Something that has to be shut down before the temp directories go — a rig whose studio is
 * still writing into one. This file's hook is registered the moment the helper is imported,
 * which is before any test file's own `after`, so a studio left to a file-level hook was being
 * stopped only after its workspace had been deleted underneath it: the removal failed with
 * ENOTEMPTY and the stop then never finished.
 */
export function closeBeforeCleanup(close: () => Promise<void>): void {
  closers.push(close);
}

after(async () => {
  for (const close of closers.splice(0)) await close().catch(() => {});
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
  created.length = 0;
});
