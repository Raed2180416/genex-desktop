import { lstat, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Repair the installed macOS node-pty helper; Linux forks through its native addon.
 * @param {{ packageDir?: string, platform?: NodeJS.Platform, arch?: NodeJS.Architecture }} options
 */
export async function prepareTerminalHelpers({ packageDir, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== "darwin") return [];
  const require = createRequire(import.meta.url);
  const root = packageDir ?? path.dirname(require.resolve("node-pty/package.json"));
  const helpers = [];
  for (const dir of ["build/Release", "build/Debug", `prebuilds/${platform}-${arch}`]) {
    const helper = path.join(root, dir, "spawn-helper");
    const info = await lstat(helper).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile()) throw new Error(`node-pty helper is not a regular file: ${helper}`);
    await chmod(helper, (info.mode & 0o777) | 0o111);
    helpers.push(helper);
  }
  if (!helpers.length) throw new Error("node-pty spawn-helper is missing; run npm run rebuild:terminal");
  return helpers;
}
