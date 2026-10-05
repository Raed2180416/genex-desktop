/** Prepare a portable catalog repository and separate upload payload; never publishes. */
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectPackage } from "../src/substrate/plugins/manifest.ts";
import { packageFiles } from "../src/substrate/plugins/pack.ts";
import { validateIndex } from "../src/substrate/plugins/marketplace.ts";
import { checkCatalog } from "../marketplace/template/scripts/check-catalog.mjs";

const [configFile, out] = process.argv.slice(2);
if (!configFile || !out) throw new Error("Usage: npm run catalog:prepare -- config.json NEW_OUTPUT_DIRECTORY");
const cfg = JSON.parse(await readFile(configFile, "utf8")),
  destination = path.resolve(out);
const base = new URL(cfg.artifactBaseUrl);
if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
  throw new Error("artifactBaseUrl must be credential-free HTTPS");
if (!Array.isArray(cfg.packages) || !cfg.packages.length) throw new Error("Supply at least one prebuilt package");
for (const spec of cfg.packages) {
  const dir = path.resolve(path.dirname(path.resolve(configFile)), spec.directory);
  if (destination === dir || destination.startsWith(dir + path.sep))
    throw new Error("Output must be outside every input package");
}
// A new directory is intentional: reruns must not replace reviewed releases or prior evidence.
await mkdir(destination);
try {
  const repository = path.join(destination, "catalog"),
    uploads = path.join(destination, "uploads");
  await cp(new URL("../marketplace/template/", import.meta.url), repository, { recursive: true });
  const entries = [],
    official = {};
  for (const spec of cfg.packages) {
    const dir = path.resolve(path.dirname(path.resolve(configFile)), spec.directory);
    const manifest = await inspectPackage(dir),
      files = await packageFiles(dir);
    const bytes = Buffer.from(JSON.stringify(files));
    if (bytes.length > 256 * 1024 * 1024) throw new Error("Artifact exceeds 256 MiB");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const rel = `${manifest.id}/${manifest.version}/${digest}.json`;
    const entry = {
      id: manifest.id,
      name: manifest.name,
      publisher: manifest.publisher,
      description: manifest.description,
      category: spec.category,
      tier: spec.tier,
      repo: spec.repo,
      sha: spec.sha,
      version: manifest.version,
      capabilities: manifest.capabilities,
      artifact: { url: `${cfg.artifactBaseUrl.replace(/\/$/, "")}/${rel}`, sha256: digest },
    };
    if (spec.subdir) entry.subdir = spec.subdir;
    if (spec.docsUrl) entry.docsUrl = spec.docsUrl;
    if (spec.minStudioVersion) entry.minStudioVersion = spec.minStudioVersion;
    // The catalog policy shape: an official id's repositories, current first, then any it moved from.
    if (spec.tier === "official") official[manifest.id] = { publisher: manifest.publisher, repos: [spec.repo] };
    entries.push(entry);
    await mkdir(path.dirname(path.join(uploads, rel)), { recursive: true });
    await writeFile(path.join(uploads, rel), bytes);
    const record = path.join(repository, "records", manifest.id, `${manifest.version}.json`);
    await mkdir(path.dirname(record), { recursive: true });
    await writeFile(record, JSON.stringify(entry, null, 2) + "\n", { flag: "wx" });
  }
  const index = validateIndex({ version: 1, updatedAt: new Date().toISOString(), plugins: entries });
  await writeFile(path.join(repository, "index.json"), JSON.stringify(index, null, 2) + "\n");
  await writeFile(
    path.join(repository, "policy.json"),
    JSON.stringify({ artifactOrigins: [base.origin], official }, null, 2) + "\n",
  );
  const report = await checkCatalog({ root: repository, artifacts: uploads });
  await writeFile(
    path.join(destination, "preparation.json"),
    JSON.stringify(
      {
        ...report,
        published: false,
        sourceProvenance: "Caller-supplied commit; maintainer must verify build bytes against source before release.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ repository, uploads, ...report, published: false }, null, 2));
} catch (e) {
  await rm(destination, { recursive: true, force: true });
  throw e;
}
