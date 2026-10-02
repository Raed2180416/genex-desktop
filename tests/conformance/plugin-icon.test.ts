import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectPackage, validateManifest } from "../../src/substrate/plugins/manifest.ts";
import { scanPackage } from "../../src/substrate/plugins/scan.ts";
import { copyOfExample, pluginFixture } from "../helpers/plugins.ts";

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

async function exampleManifest(): Promise<Record<string, unknown>> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path.resolve("src/plugins/example/plugin.json"), "utf8"));
}

test("a manifest's icon is a picture file inside the package; anything else is refused", async () => {
  const base = await exampleManifest();
  assert.equal(validateManifest({ ...base, icon: "icon.png" }).icon, "icon.png");
  assert.equal(validateManifest({ ...base, icon: "art/icon.svg" }).icon, "art/icon.svg");
  assert.equal(validateManifest(base).icon, undefined, "no icon, no key");
  for (const icon of [
    "/etc/icon.png",
    "../icon.png",
    "art/../../icon.png",
    "icon.gif",
    "icon.html",
    "icon",
    3,
    "",
    null,
  ])
    assert.throws(() => validateManifest({ ...base, icon }), /icon/i, String(icon));
});

test("the package's icon must be there, a plain file, small, and the picture its name says", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-icon-"));
  try {
    const withIcon = (name: string, icon: string) => copyOfExample(root, name, (m) => (m.icon = icon));
    const good = await withIcon("good", "icon.png");
    await writeFile(path.join(good, "icon.png"), PNG);
    assert.equal((await inspectPackage(good)).icon, "icon.png");

    const svg = await withIcon("svg", "icon.svg");
    await writeFile(path.join(svg, "icon.svg"), SVG);
    assert.equal((await inspectPackage(svg)).icon, "icon.svg");

    await assert.rejects(inspectPackage(await withIcon("missing", "icon.png")), /icon/i);

    const lying = await withIcon("lying", "icon.png");
    await writeFile(path.join(lying, "icon.png"), "<script>alert(1)</script>");
    await assert.rejects(inspectPackage(lying), /icon/i);

    const notSvg = await withIcon("not-svg", "icon.svg");
    await writeFile(path.join(notSvg, "icon.svg"), PNG);
    await assert.rejects(inspectPackage(notSvg), /icon/i);

    const huge = await withIcon("huge", "icon.png");
    await writeFile(path.join(huge, "icon.png"), Buffer.concat([PNG, Buffer.alloc(600 * 1024)]));
    await assert.rejects(inspectPackage(huge), /icon/i);

    const linked = await withIcon("linked", "icon.png");
    await symlink(path.join(good, "icon.png"), path.join(linked, "icon.png"));
    await assert.rejects(inspectPackage(linked));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the scan reads a declared icon as a picture, not as unread code; any other picture stays disclosed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-icon-scan-"));
  try {
    const dir = await copyOfExample(root, "pkg", (m) => (m.icon = "icon.png"));
    await writeFile(path.join(dir, "icon.png"), PNG);
    const declared = await scanPackage(dir, await inspectPackage(dir));
    assert.equal(declared.verdict, "safe");
    assert.ok(!declared.findings.some((f) => f.file === "icon.png"));

    await writeFile(path.join(dir, "other.png"), PNG);
    const other = await scanPackage(dir, await inspectPackage(dir));
    assert.ok(other.findings.some((f) => f.file === "other.png" && f.rule === "not-scanned"));

    // A declared icon that is not the picture it claims is code the scan did not read.
    const fake = await copyOfExample(root, "fake", (m) => (m.icon = "icon.png"));
    await writeFile(path.join(fake, "icon.png"), PNG);
    const manifest = await inspectPackage(fake);
    await writeFile(path.join(fake, "icon.png"), "module.exports = require('child_process')");
    const swapped = await scanPackage(fake, manifest);
    assert.ok(swapped.findings.some((f) => f.file === "icon.png" && f.rule === "not-scanned"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an installed plugin's icon is read from its own package, on or off; a plugin without one has none", async () => {
  const f = await pluginFixture({ installed: "local" });
  try {
    assert.equal(await f.registry.icon("example"), null, "the example ships no icon");
    const dir = await copyOfExample(f.root, "iconic", (m) => (m.icon = "icon.png"));
    await writeFile(path.join(dir, "icon.png"), PNG);
    await f.registry.installLocal(dir, "local");
    const icon = await f.registry.icon("example");
    assert.deepEqual(icon && { type: icon.type, bytes: icon.bytes.equals(PNG) }, { type: "image/png", bytes: true });
    // The package copy is what is served: editing the source folder changes nothing until a reload.
    await writeFile(path.join(dir, "icon.png"), SVG);
    assert.ok((await f.registry.icon("example"))?.bytes.equals(PNG));
    await f.registry.setEnabled("example", false);
    assert.equal((await f.registry.icon("example"))?.type, "image/png", "a switched-off plugin keeps its picture");
    assert.equal(await f.registry.icon("nope"), null);
  } finally {
    await f.close();
  }
});

test("a bundled plugin installed before it shipped a picture shows the one Studio now bundles", async () => {
  const f = await pluginFixture();
  try {
    assert.equal(f.registry.list().find((p) => p.manifest.id === "example")?.iconUrl, undefined);
    f.registry.cancel();
    // Studio updates: the bundled seed now ships an icon, the installed copy still has none.
    const { readFile } = await import("node:fs/promises");
    const seed = path.join(f.seeds, "example");
    const manifest = JSON.parse(await readFile(path.join(seed, "plugin.json"), "utf8"));
    await writeFile(path.join(seed, "plugin.json"), JSON.stringify({ ...manifest, icon: "icon.png" }));
    await writeFile(path.join(seed, "icon.png"), PNG);
    const { PluginRegistry } = await import("../../src/substrate/plugins/registry.ts");
    const { PLUGIN_SDK_BACKEND } = await import("../helpers/plugins.ts");
    const again = new PluginRegistry(path.join(f.root, "installed"), f.seeds, PLUGIN_SDK_BACKEND, async () => ({}));
    await again.init();
    try {
      const info = again.list().find((p) => p.manifest.id === "example");
      assert.equal(info?.manifest.icon, undefined, "the installed copy is unchanged");
      assert.match(info?.iconUrl ?? "", /^studio-plugin:\/\/example\/\.icon\?v=/);
      assert.ok((await again.icon("example"))?.bytes.equals(PNG));
    } finally {
      again.cancel();
    }
  } finally {
    await f.close();
  }
});
