/**
 * A Windows install unpacks the Genex plugin payload under the user's profile folder, and the
 * Squirrel installer (like Explorer and most tools) refuses paths of 260 characters or more. The
 * payload is the app's deepest tree, so its longest file decides whether an install under a long
 * user name works at all.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildPlugins } from "../../scripts/build-plugins.mjs";
import { tmpDir } from "../helpers/tmp.ts";

/** Windows' MAX_PATH, which counts the terminating NUL. */
const MAX_PATH = 260;
/** The longest local account name Windows allows, which names the profile folder. */
const LONGEST_USER_NAME = "x".repeat(20);

async function relativeFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
}

test("every Genex plugin payload file fits MAX_PATH in a Squirrel install under the longest user name", async () => {
  const resources = path.join(await tmpDir("studio-payload-"), "resources");
  await buildPlugins(process.cwd(), resources);
  const { version } = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const installedResources = `C:\\Users\\${LONGEST_USER_NAME}\\AppData\\Local\\genex\\app-${version}\\resources\\app.asar.unpacked\\dist\\resources\\`;
  const tooLong = (await relativeFiles(resources))
    .map((file) => installedResources + file.split(path.sep).join("\\"))
    .filter((installed) => installed.length >= MAX_PATH);
  assert.deepEqual(tooLong, []);
});

/** Files no runtime loads: TypeScript declarations and source maps. */
const NEVER_LOADED = /\.(d\.[cm]?ts|map)$/;

test("the Genex plugin payload ships no declarations or source maps, which a first launch would copy", async () => {
  const resources = path.join(await tmpDir("studio-payload-"), "resources");
  await buildPlugins(process.cwd(), resources);
  const files = await relativeFiles(path.join(resources, "plugins/genex"));
  assert.ok(files.some((file) => file.endsWith(path.join("@genex-ai", "cli-demo", "dist", "index.js"))));
  assert.deepEqual(
    files.filter((file) => NEVER_LOADED.test(file)),
    [],
  );
});
