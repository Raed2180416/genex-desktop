import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");

/**
 * The absolute path of an installed package's executable, read from its package.json `bin`, so a
 * caller spawns `process.execPath <bin>` without hard-coding where a release keeps its launcher or
 * trusting node_modules/.bin, where two packages can claim one name (see scripts/tsc.ts).
 * TypeScript 7's `exports` hide `bin/`, but a package always exports its package.json.
 */
export function packageBin(pkg: string, name: string, from = repo): string {
  const manifest = createRequire(path.join(from, "package.json")).resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin?: string | Record<string, string> };
  const rel = typeof bin === "string" ? bin : bin?.[name];
  if (!rel) throw new Error(`${pkg} has no "${name}" bin`);
  return path.join(path.dirname(manifest), rel);
}
