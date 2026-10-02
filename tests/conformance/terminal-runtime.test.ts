import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, writeFile, chmod, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { prepareTerminalHelpers } from "../../scripts/terminal-runtime.mjs";
import { tmpDir } from "../helpers/tmp.ts";

it("source installation repairs only the active platform's terminal helper execute bits", async () => {
  const root = await tmpDir("terminal-install-");
  const own = path.join(root, "prebuilds/darwin-arm64/spawn-helper");
  const other = path.join(root, "prebuilds/linux-x64/spawn-helper");
  for (const file of [own, other]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "synthetic helper");
    await chmod(file, 0o640);
  }
  const helpers = await prepareTerminalHelpers({ packageDir: root, platform: "darwin", arch: "arm64" });
  assert.deepEqual(helpers, [own]);
  assert.equal((await stat(own)).mode & 0o777, 0o751);
  assert.equal((await stat(other)).mode & 0o777, 0o640);
  assert.deepEqual(await prepareTerminalHelpers({ packageDir: root, platform: "win32", arch: "x64" }), []);
});

it("terminal helper repair refuses symlinks without changing their target", async () => {
  const root = await tmpDir("terminal-link-");
  const outside = path.join(root, "outside");
  await writeFile(outside, "private synthetic file");
  await chmod(outside, 0o600);
  const dir = path.join(root, "prebuilds/darwin-arm64");
  await mkdir(dir, { recursive: true });
  await symlink(outside, path.join(dir, "spawn-helper"));
  await assert.rejects(prepareTerminalHelpers({ packageDir: root, platform: "darwin", arch: "arm64" }), /regular file/);
  assert.equal((await stat(outside)).mode & 0o777, 0o600);
});

it("Linux terminal installation needs no macOS spawn-helper and leaves unrelated files untouched", async () => {
  const root = await tmpDir("terminal-linux-");
  assert.deepEqual(await prepareTerminalHelpers({ packageDir: root, platform: "linux", arch: "x64" }), []);
  const helper = path.join(root, "build/Release/spawn-helper");
  await mkdir(path.dirname(helper), { recursive: true });
  await writeFile(helper, "synthetic unrelated file");
  await chmod(helper, 0o600);
  assert.deepEqual(await prepareTerminalHelpers({ packageDir: root, platform: "linux", arch: "x64" }), []);
  assert.equal((await stat(helper)).mode & 0o777, 0o600);
});
