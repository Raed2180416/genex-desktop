/** Prebuilt packages only: no dependency installation, build hooks or network access. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectPackage } from "../src/substrate/plugins/manifest.ts";
import { packageFiles } from "../src/substrate/plugins/pack.ts";
import { isInside } from "../src/substrate/paths.ts";
const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("Usage: node scripts/pack-plugin.ts <prebuilt-directory> <artifact.json>");
const root = path.resolve(directory),
  destination = path.resolve(output);
if (isInside(root, destination)) throw new Error("Artifact output must be outside the plugin package");
const manifest = await inspectPackage(root),
  files = await packageFiles(root);
const bytes = Buffer.from(JSON.stringify(files));
if (bytes.length > 256 * 1024 * 1024) throw new Error("Artifact exceeds 256 MiB");
await writeFile(destination, bytes);
console.log(
  JSON.stringify(
    { manifest, sha256: createHash("sha256").update(bytes).digest("hex"), artifact: destination },
    null,
    2,
  ),
);
