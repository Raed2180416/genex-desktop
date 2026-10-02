import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { checkCatalog } from "../../marketplace/template/scripts/check-catalog.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "catalog-release-"));
  const pkg = path.join(root, "package");
  await cp("src/plugins/example", pkg, { recursive: true });
  const config = path.join(root, "config.json");
  await writeFile(
    config,
    JSON.stringify({
      artifactBaseUrl: "https://plugins.example.invalid/releases",
      packages: [{ directory: pkg, category: "tools", tier: "community", repo: "acme/plugins", sha: "a".repeat(40) }],
    }),
  );
  const output = path.join(root, "output");
  execFileSync(process.execPath, ["scripts/prepare-plugin-catalog.mjs", config, output], { stdio: "pipe" });
  const catalog = path.join(output, "catalog"),
    uploads = path.join(output, "uploads");
  const index = JSON.parse(await readFile(path.join(catalog, "index.json"), "utf8"));
  const entry = index.plugins[0];
  const previous = path.join(root, "previous");
  await cp(catalog, previous, { recursive: true });
  async function save() {
    await writeFile(path.join(catalog, "index.json"), JSON.stringify(index));
    await mkdir(path.join(catalog, "records", entry.id), { recursive: true });
    await writeFile(path.join(catalog, "records", entry.id, `${entry.version}.json`), JSON.stringify(entry));
  }
  const check = (artifacts: string | undefined = undefined) =>
    checkCatalog({ root: catalog, previous, policyRoot: previous, artifacts, remote: false });
  return {
    root,
    catalog,
    uploads,
    index,
    entry,
    previous,
    save,
    check,
    clean: () => rm(root, { recursive: true, force: true }),
  };
}
test("portable catalog preparation validates actual packages without executing backend code", async () => {
  const f = await fixture();
  try {
    const report = await f.check(f.uploads);
    assert.equal(report.entries, 1);
    assert.equal(report.artifactsVerified.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(f.root, "output/preparation.json"), "utf8")).published, false);
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ["scripts/prepare-plugin-catalog.mjs", path.join(f.root, "config.json"), path.join(f.root, "output")],
          { stdio: "pipe" },
        ),
      /EEXIST/,
    );
    assert.equal((await f.check(f.uploads)).entries, 1, "existing preparation preserved");
  } finally {
    await f.clean();
  }
});
test("release gate refuses repacks, removed history, ownership takeover and rollback", async () => {
  for (const scenario of ["repack", "remove", "publisher", "repo", "downgrade"]) {
    const f = await fixture();
    try {
      if (scenario === "remove") await rm(path.join(f.catalog, "records", f.entry.id, `${f.entry.version}.json`));
      else if (scenario === "repack") {
        f.entry.sha = "b".repeat(40);
        await f.save();
      } else {
        f.entry.version = scenario === "downgrade" ? "0.0.1" : "2.0.0";
        if (scenario === "publisher") f.entry.publisher = "Other";
        if (scenario === "repo") f.entry.repo = "other/plugins";
        f.entry.artifact.url = `https://plugins.example.invalid/releases/${f.entry.id}/${f.entry.version}/${f.entry.artifact.sha256}.json`;
        await f.save();
      }
      await assert.rejects(f.check(), /record|ownership|higher version/i, scenario);
    } finally {
      await f.clean();
    }
  }
});
test("release gate pins artifact bytes and rejects traversal without executing files", async () => {
  const f = await fixture();
  try {
    const artifact = path.join(f.uploads, f.entry.id, f.entry.version, `${f.entry.artifact.sha256}.json`);
    await writeFile(artifact, "tampered");
    await assert.rejects(f.check(f.uploads), /digest/);
    const envelope = Buffer.from(
      JSON.stringify({
        "plugin.json": Buffer.from("{}").toString("base64"),
        "../escape": Buffer.from("x").toString("base64"),
      }),
    );
    const digest = createHash("sha256").update(envelope).digest("hex");
    f.entry.artifact.sha256 = digest;
    f.entry.artifact.url = `https://plugins.example.invalid/releases/${f.entry.id}/${f.entry.version}/${digest}.json`;
    await f.save();
    await writeFile(path.join(path.dirname(artifact), `${digest}.json`), envelope);
    await assert.rejects(checkCatalog({ root: f.catalog, artifacts: f.uploads }), /Unsafe package path/);
  } finally {
    await f.clean();
  }
});
test("base policy cannot be expanded by a candidate and official IDs are reserved", async () => {
  const f = await fixture();
  try {
    f.entry.artifact.url = f.entry.artifact.url.replace("plugins.example.invalid", "attacker.invalid");
    await f.save();
    await assert.rejects(f.check(), /Unapproved artifact origin/);
    f.entry.artifact.url = f.entry.artifact.url.replace("attacker.invalid", "plugins.example.invalid");
    f.entry.tier = "official";
    await f.save();
    await assert.rejects(f.check(), /Official identity not approved/);
  } finally {
    await f.clean();
  }
});
