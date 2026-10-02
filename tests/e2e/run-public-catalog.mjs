/** Opt-in live distribution check. No account, assets, UI or user profile is used. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PluginMarketplace, STUDIO_CATALOG_POLICY } from "../../src/substrate/plugins/marketplace.ts";
import { PluginRegistry } from "../../src/substrate/plugins/registry.ts";
if (!process.argv.includes("--live")) throw Error("Pass --live to download and execute the reviewed official packages");
const root = await mkdtemp(path.join(os.tmpdir(), "studio-catalog-acceptance-"));
const seeds = path.join(root, "seeds");
await mkdir(seeds);
const registry = new PluginRegistry(
  path.join(root, "installed"),
  seeds,
  path.resolve("src/plugin-sdk/backend.mjs"),
  async (id, method) => {
    if (method === "storage.root") {
      const dir = path.join(root, "data", id);
      await mkdir(dir, { recursive: true });
      return dir;
    }
    if (method === "credentials.read" || method === "events.emit") return null;
    throw Error(`Unexpected acceptance service: ${method}`);
  },
);
try {
  await registry.init();
  const marketplace = new PluginMarketplace({ root: path.join(root, "market"), studioVersion: "0.1.0" });
  const index = await marketplace.index(true);
  assert.equal(index.error, undefined);
  assert.equal(index.stale, false);
  for (const id of ["genex", "blender"]) {
    const entry = index.entries.find((e) => e.id === id);
    assert.ok(entry, `${id} is discoverable`);
    assert.equal(entry.tier, "official");
    // Either official source repository while the catalog moves from the legacy one (docs/plugins.md).
    assert.ok(STUDIO_CATALOG_POLICY.official[id].repos.includes(entry.repo), `${id} names ${entry.repo}`);
    assert.ok(entry.artifact?.url.startsWith("https://plugins.genex.games/releases/"));
    const result = await marketplace.installIndex(id, registry, entry.capabilities);
    assert.equal(result.manifest.version, entry.version);
    console.log(`PASS anonymous install ${id} ${entry.version}`);
  }
  const status = await registry.tool(
    "genex__asset",
    { operation: "status" },
    { project: "acceptance", directory: root },
  );
  assert.equal(status.connected, false);
  assert.ok(status.operations.includes("model"));
  console.log("PASS real Genex backend status; no account or paid generation");
  const cached = new PluginMarketplace({ root: path.join(root, "market"), studioVersion: "0.1.0", offline: true });
  const offline = await cached.index();
  assert.equal(offline.stale, true);
  assert.equal(offline.entries.length, index.entries.length);
  console.log("PASS offline cached discovery");
} finally {
  registry.cancel();
  await rm(root, { recursive: true, force: true });
}
