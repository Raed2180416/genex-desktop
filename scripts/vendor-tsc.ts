/**
 * Vendor TypeScript 7's native compiler into the app's resources for the in-app type gate
 * (`src/substrate/type-gate.ts` owns the layout and the check).
 *
 * Copied from what `npm ci` already installed — never downloaded: the platform package(s)
 * `@typescript/typescript-<platform>-<arch>` (the `tsc` binary plus the `lib.*.d.ts` files it reads
 * from beside itself), and `@types/node` with the `undici-types` it imports, which the harness
 * tsconfig's `types: ["node"]` resolves through `--typeRoots`. npm installs only this machine's
 * platform package, so a build carries the compiler for the arch it was built on.
 *
 * `scripts/build.mjs` copies; `tests/helpers/resources.ts` links (`link: true`) so every test core
 * gets a working gate without copying 27 MB each time.
 */
import { cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TSC_DIR, tscLayout } from "../src/substrate/type-gate.ts";

export interface VendoredTsc {
  /** `<platform>-<arch>` of every compiler vendored. */
  platforms: string[];
  /** Bytes per platform folder (binary + lib files), and of the shared type roots. */
  bytes: Record<string, number>;
}

/** The installed `@typescript/typescript-<platform>-<arch>` packages for `platform`. */
async function platformPackages(root: string, platform: string): Promise<Array<{ id: string; dir: string }>> {
  const scope = path.join(root, "node_modules", "@typescript");
  const out: Array<{ id: string; dir: string }> = [];
  for (const name of (await readdir(scope).catch(() => [] as string[])).sort()) {
    const match = /^typescript-([a-z0-9]+-[a-z0-9]+)$/.exec(name);
    if (match && match[1]!.startsWith(`${platform}-`)) out.push({ id: match[1]!, dir: path.join(scope, name) });
  }
  return out;
}

function packageDir(from: string, name: string): string {
  return path.dirname(createRequire(path.join(from, "package.json")).resolve(`${name}/package.json`));
}

async function size(target: string): Promise<number> {
  const info = await stat(target);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(target)) total += await size(path.join(target, entry));
  return total;
}

export async function vendorTsc(
  root: string,
  resources: string,
  { link = false, platform = process.platform }: { link?: boolean; platform?: string } = {},
): Promise<VendoredTsc> {
  const dest = path.join(resources, TSC_DIR);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const place = async (from: string, to: string): Promise<void> => {
    await mkdir(path.dirname(to), { recursive: true });
    // A junction on Windows: it needs no symlink privilege (ignored elsewhere).
    if (link) await symlink(from, to, "junction");
    else await cp(from, to, { recursive: true, dereference: true });
  };

  const packages = await platformPackages(root, platform);
  if (packages.length === 0)
    throw new Error(`no @typescript/typescript-${platform}-* package is installed; run npm ci`);
  const bytes: Record<string, number> = {};
  for (const { id, dir } of packages) {
    const target = path.join(dest, id);
    await place(path.join(dir, "lib"), target);
    bytes[id] = await size(path.join(dir, "lib"));
  }
  const typesNode = packageDir(root, "@types/node");
  const undici = packageDir(typesNode, "undici-types");
  const { typeRoots } = tscLayout(resources, platform);
  await place(typesNode, path.join(typeRoots, "node"));
  await place(undici, path.join(path.dirname(typeRoots), "undici-types"));
  bytes.types = (await size(typesNode)) + (await size(undici));

  const version = (dir: string) =>
    readFile(path.join(dir, "package.json"), "utf8").then((text) => (JSON.parse(text) as { version: string }).version);
  const typescript = packageDir(root, "typescript");
  if (!link) {
    for (const notice of ["LICENSE", "NOTICE.txt"])
      await cp(path.join(typescript, notice), path.join(dest, notice)).catch(() => {});
  }
  await writeFile(
    path.join(dest, "VERSION.json"),
    `${JSON.stringify(
      {
        typescript: await version(typescript),
        "@types/node": await version(typesNode),
        "undici-types": await version(undici),
        platforms: packages.map((entry) => entry.id),
      },
      null,
      2,
    )}\n`,
  );
  return { platforms: packages.map((entry) => entry.id), bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(import.meta.dirname, "..");
  const out = process.argv[2] ?? path.join(root, "dist", "resources");
  const result = await vendorTsc(root, out);
  for (const [id, n] of Object.entries(result.bytes)) console.log(`${id}: ${(n / 1024 / 1024).toFixed(1)} MB`);
}
