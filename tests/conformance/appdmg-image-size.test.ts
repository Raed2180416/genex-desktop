/**
 * The DMG maker's appdmg sizes the install window from its background with image-size 0.7's
 * `sizeOf(path, callback)`. package.json overrides that dependency with a local adapter over
 * image-size 2, so no vulnerable image-size is installed; it must answer the old call the same way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sizeOf from "../../scripts/appdmg-image-size/index.cjs";
import { tmpDir } from "../helpers/tmp.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);

type Size = { width: number; height: number; type?: string };

function measure(file: string): Promise<{ error: NodeJS.ErrnoException | null; size?: Size; sync: boolean }> {
  return new Promise((resolve) => {
    let returned = false;
    sizeOf(file, (error: NodeJS.ErrnoException | null, size?: Size) => resolve({ error, size, sync: !returned }));
    returned = true;
  });
}

test("the DMG background is measured asynchronously at its 1x size", async () => {
  const { error, size, sync } = await measure(path.join(repoRoot, "build", "dmg-background.png"));
  assert.equal(error, null);
  assert.equal(sync, false);
  assert.deepEqual([size?.width, size?.height, size?.type], [660, 400, "png"]);
});

test("a missing background answers with the file system error and no size", async () => {
  const { error, size } = await measure(path.join(await tmpDir("studio-appdmg-size-"), "missing.png"));
  assert.equal(error?.code, "ENOENT");
  assert.equal(size, undefined);
});

test("a call without a callback is refused", () => {
  assert.throws(() => sizeOf(path.join(repoRoot, "build", "dmg-background.png")), TypeError);
});

test("appdmg loads the adapter, not a vulnerable image-size", (t) => {
  let appdmg: string;
  try {
    appdmg = require.resolve("appdmg/lib/appdmg.js");
  } catch {
    t.skip("appdmg is an optional macOS-only dependency and is not installed here");
    return;
  }
  assert.equal(createRequire(appdmg)("image-size"), sizeOf);
});
