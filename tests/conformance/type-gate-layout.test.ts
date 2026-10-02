/**
 * Where the in-app type gate finds its compiler: the layout `scripts/vendor-tsc.ts` writes and
 * `substrate/type-gate.ts` reads. TypeScript 7's native compiler is `tsc` on macOS and Linux and
 * `tsc.exe` on Windows; a gate that looked for the wrong name would fail closed on every edit.
 */
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { vendorTsc } from "../../scripts/vendor-tsc.ts";
import { tscLayout } from "../../src/substrate/type-gate.ts";
import { tmpDir } from "../helpers/tmp.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("the compiler is tsc on macOS and Linux and tsc.exe on Windows, under <platform>-<arch>", () => {
  const cases = [
    { platform: "darwin", arch: "arm64", binary: path.join("darwin-arm64", "tsc") },
    { platform: "linux", arch: "x64", binary: path.join("linux-x64", "tsc") },
    { platform: "win32", arch: "x64", binary: path.join("win32-x64", "tsc.exe") },
    { platform: "win32", arch: "arm64", binary: path.join("win32-arm64", "tsc.exe") },
  ];
  for (const { platform, arch, binary } of cases) {
    const layout = tscLayout("resources", platform, arch);
    assert.equal(layout.binary, path.join("resources", "tsc", binary), `${platform}-${arch}`);
  }
});

test("the vendored compiler for this machine is where the gate looks for it", async () => {
  const resources = await tmpDir("type-gate-layout-");
  const vendored = await vendorTsc(root, resources, { link: true });
  assert.ok(vendored.platforms.includes(`${process.platform}-${process.arch}`), vendored.platforms.join(", "));
  const layout = tscLayout(resources);
  assert.ok((await stat(layout.binary)).isFile(), layout.binary);
  assert.ok((await stat(path.join(layout.typeRoots, "node", "package.json"))).isFile());
});
