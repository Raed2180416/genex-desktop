/**
 * Packaging refuses a checkout whose node_modules is a symlink: the packager copies the link as a
 * link, so its prune and the afterPrune hooks would delete the linked tree's devDependencies and
 * other platforms' binaries in place — in whatever checkout owns it. The refusal happens before
 * anything is copied and leaves the linked tree untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forgeConfig from "../../forge.config.cjs";
import prune from "../../scripts/package-prune.cjs";
import { tmpDir } from "../helpers/tmp.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** The refusal, exactly as packaging prints it for a checkout. */
const refusal = (checkoutDir: string) =>
  `Refusing to package: ${path.join(checkoutDir, "node_modules")} is a symlink, and packaging would prune the linked install in place. Package from a checkout with its own node_modules (npm ci).`;

async function checkout(): Promise<{ app: string; shared: string }> {
  const root = await tmpDir("studio-linked-modules-");
  const app = path.join(root, "app");
  const shared = path.join(root, "shared", "node_modules");
  await mkdir(path.join(shared, "typescript"), { recursive: true });
  await writeFile(path.join(shared, "typescript", "package.json"), "{}");
  await mkdir(app);
  return { app, shared };
}

test("a linked node_modules (absolute or relative) is refused, naming the link, and the linked tree is untouched", async () => {
  for (const relative of [false, true]) {
    const { app, shared } = await checkout();
    const target = relative ? path.relative(app, shared) : shared;
    await symlink(target, path.join(app, "node_modules"));
    await assert.rejects(prune.refuseLinkedModules(app), { message: refusal(app) });
    assert.deepEqual(await readdir(shared), ["typescript"]);
  }
});

test("forge runs the refusal on its own checkout before packaging copies anything", async () => {
  const prePackage = forgeConfig.hooks.prePackage as () => Promise<void>;
  const linked = (await lstat(path.join(repoRoot, "node_modules"))).isSymbolicLink();
  if (linked) await assert.rejects(prePackage(), { message: refusal(repoRoot) });
  else await prePackage();
});

test("a real node_modules folder, or none, packages", async () => {
  const { app } = await checkout();
  await prune.refuseLinkedModules(app);
  await mkdir(path.join(app, "node_modules"));
  await prune.refuseLinkedModules(app);
});
