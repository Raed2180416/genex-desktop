/**
 * How a raw lane reaches `look-at-page` (D10) without learning where the harness checkout is: the
 * command and what it imports (its one shared module and the pinned Playwright packages) are copied
 * once into an eval-owned folder under the builds folder, and the lane's PATH shim runs that copy.
 * A shim that ran the checkout's own file would show the agent the repository (and its public
 * cases' acceptance lists) to anyone who reads it.
 */
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { shellQuote } from "../../../src/substrate/spawn.ts";
import { textDigest } from "./common.ts";
import { LOOK_AT_PAGE_COMMAND } from "./look-at-page.ts";

/** The repository these scripts ship in. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
/** The command's own file and the one shared module it imports, as repository paths; copied with their layout. */
const TOOL_SOURCES = ["scripts/evals/lanes/look-at-page.ts", "src/shared/duration.ts"] as const;
/** The command's entry inside an install. */
const TOOL_ENTRY = TOOL_SOURCES[0];
/** The packages `@playwright/test` needs at run time, copied from the checkout's `node_modules`. */
const TOOL_PACKAGES = ["@playwright/test", "playwright", "playwright-core"] as const;
/** The folder-name prefix of an install; the suffix is the digest of what it holds. */
const TOOL_DIR_PREFIX = "look-at-page-";
/** The marker a finished install leaves, so the next run reuses it. */
const TOOL_MARKER = ".installed";
/** The install's own package file: the copied sources are ES modules. */
const TOOL_PACKAGE_JSON = `${JSON.stringify({ private: true, type: "module" })}\n`;

/** The installed version of a package in the checkout. */
async function packageVersion(name: string, repo: string): Promise<string> {
  const file = createRequire(path.join(repo, "package.json")).resolve(`${name}/package.json`);
  return (JSON.parse(await readFile(file, "utf8")) as { version?: string }).version ?? "";
}

/** The digest of what an install holds: the sources' text and the packages' versions. */
async function toolDigest(repo: string): Promise<string> {
  const sources = await Promise.all(TOOL_SOURCES.map((file) => readFile(path.join(repo, file), "utf8")));
  const versions = await Promise.all(TOOL_PACKAGES.map((name) => packageVersion(name, repo)));
  return textDigest(...sources, ...versions);
}

/** Copy the sources and packages into a fresh folder. */
async function fillTool(dir: string, repo: string): Promise<void> {
  for (const file of TOOL_SOURCES) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await cp(path.join(repo, file), path.join(dir, file));
  }
  const require = createRequire(path.join(repo, "package.json"));
  for (const name of TOOL_PACKAGES) {
    const from = path.dirname(require.resolve(`${name}/package.json`));
    await cp(from, path.join(dir, "node_modules", name), { recursive: true, dereference: true });
  }
  await writeFile(path.join(dir, "package.json"), TOOL_PACKAGE_JSON, "utf8");
  await writeFile(path.join(dir, TOOL_MARKER), "", "utf8");
}

/**
 * The `look-at-page` command installed under `buildsDir` (reused when a finished install of the
 * same sources and versions is there), and its entry file's path. Two lanes installing at once each
 * fill a folder of their own; the first to finish is kept.
 */
export async function installLookAtPageTool(buildsDir: string, repo: string = REPO_ROOT): Promise<string> {
  const dir = path.join(buildsDir, `${TOOL_DIR_PREFIX}${await toolDigest(repo)}`);
  const entry = path.join(dir, TOOL_ENTRY);
  if (await stat(path.join(dir, TOOL_MARKER)).catch(() => null)) return entry;
  await mkdir(buildsDir, { recursive: true });
  const staging = await mkdtemp(path.join(buildsDir, `.${TOOL_DIR_PREFIX}`));
  try {
    await fillTool(staging, repo);
    await rename(staging, dir).catch(async (error: unknown) => {
      // Another lane finished the same install first: keep it.
      if (!(await stat(path.join(dir, TOOL_MARKER)).catch(() => null))) throw error;
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return entry;
}

/**
 * Write the `look-at-page` shim into `dir` (a folder for the lane's PATH): a POSIX script that runs
 * `script` (an installed copy, `installLookAtPageTool`) with the given Node. Returns the folder.
 */
export async function writeLookAtPageShim(dir: string, node: string, script: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, LOOK_AT_PAGE_COMMAND);
  await writeFile(file, `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(script)} "$@"\n`, "utf8");
  await chmod(file, 0o755);
  return dir;
}
