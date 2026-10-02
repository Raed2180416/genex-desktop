/**
 * The third-party notices a build ships. Every npm package bundled into the app's JavaScript or
 * compiled into its stylesheet keeps its own license files under `dist/resources/third-party`,
 * listed in NOTICE.md. A package that ships no license file must have a section in
 * THIRD-PARTY-NOTICES.md (shipped as PROJECT-SOURCES.md), and every library three.js vendors in
 * `examples/jsm/libs` must be listed there too. A gap stops the build, before anything is written.
 */
import fs from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** The heading of THIRD-PARTY-NOTICES.md's table of three.js's vendored libraries. */
const THREE_LIBS_HEADING = "## three.js add-on libraries";

/** The installed package a file belongs to: the nearest named, versioned package.json above it. */
export function packageOf(root, input) {
  const modules = path.join(root, "node_modules") + path.sep;
  for (let dir = path.dirname(path.resolve(root, input)); dir.startsWith(modules); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (pkg.name && pkg.version) return { dir, pkg };
  }
  return null;
}

/** A package's own license and notice files. */
export function noticeFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file) && fs.statSync(path.join(dir, file)).isFile());
}

/**
 * The packages a stylesheet imports by name (`@import "tailwindcss";`), as the package.json each
 * resolves to; relative imports are the app's own files. The Tailwind CLI, not esbuild, compiles
 * these into the shipped theme.css, so the JavaScript bundle's inputs never name them.
 */
export function stylesheetPackages(css) {
  const manifests = [];
  for (const [, specifier] of css.matchAll(/^\s*@import\s+["']([^"']+)["']/gm)) {
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    manifests.push(`node_modules/${name}/package.json`);
  }
  return manifests;
}

/** Whether THIRD-PARTY-NOTICES.md gives a package its own section: a heading naming it exactly. */
function hasNoticeSection(markdown, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,3} (?:.*[\\s(])?${escaped}(?:[\\s)].*)?$`, "m").test(markdown);
}

/** The bundled packages, sorted by name, each with the license files it ships. */
function bundledPackages(root, inputs) {
  const packages = new Map();
  for (const input of inputs) {
    if (!input.includes("node_modules/")) continue;
    const found = packageOf(root, input);
    if (found) packages.set(found.dir, found.pkg);
  }
  return [...packages]
    .map(([dir, pkg]) => ({ dir, pkg, notices: noticeFiles(dir) }))
    .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
}

/**
 * Writes `dist/resources/third-party`: NOTICE.md, each bundled package's license files, the
 * project's copied-source notices and the root license. Refuses, writing nothing, when a bundled
 * package ships no license file and THIRD-PARTY-NOTICES.md has no section for it.
 */
export async function writeBundledNotices({ root, dist, inputs }) {
  const projectNotices = fs.readFileSync(path.join(root, "THIRD-PARTY-NOTICES.md"), "utf8");
  const packages = bundledPackages(root, inputs);
  const unlicensed = packages
    .filter(({ pkg, notices }) => notices.length === 0 && !hasNoticeSection(projectNotices, pkg.name))
    .map(({ pkg }) => `${pkg.name} ${pkg.version}`);
  if (unlicensed.length > 0) {
    throw new Error(
      `Bundled packages ship no license file and THIRD-PARTY-NOTICES.md has no section for them: ${unlicensed.join(", ")}`,
    );
  }
  const destination = path.join(dist, "resources", "third-party");
  await mkdir(destination, { recursive: true });
  const lines = [
    "# Bundled third-party software",
    "",
    "Generated from the bundle input packages. External runtime packages retain their notices in node_modules; Electron includes its own notices.",
    "",
  ];
  for (const { dir, pkg, notices } of packages) {
    const license = typeof pkg.license === "string" ? pkg.license : "license metadata not reported";
    const where = notices.length ? notices.join(", ") : "notice in PROJECT-SOURCES.md";
    lines.push(`- ${pkg.name} ${pkg.version}: ${license}; ${where}`);
    const folder = path.join(destination, `${pkg.name.replaceAll("/", "_")}@${pkg.version}`);
    if (notices.length) await mkdir(folder, { recursive: true });
    for (const file of notices) await cp(path.join(dir, file), path.join(folder, file));
  }
  await cp(path.join(root, "src/renderer/ui/GENEX-SOURCES.md"), path.join(destination, "Genex-SOURCES.md"));
  await cp(path.join(root, "THIRD-PARTY-NOTICES.md"), path.join(destination, "PROJECT-SOURCES.md"));
  await cp(path.join(root, "LICENSE"), path.join(dist, "resources", "LICENSE"));
  lines.push("- Copied project sources: PROJECT-SOURCES.md. Studio's own license: ../LICENSE.");
  lines.push("- Vendored Genex UI: Genex-SOURCES.md. Font OFL notices accompany renderer/fonts.");
  await writeFile(path.join(destination, "NOTICE.md"), `${lines.join("\n")}\n`);
}

/** The backticked file or folder names in the first column of the three.js libraries table. */
function listedThreeLibs(markdown) {
  const start = markdown.indexOf(THREE_LIBS_HEADING);
  if (start === -1) return [];
  const rest = markdown.slice(start + THREE_LIBS_HEADING.length);
  const end = rest.search(/^## /m);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\|\s*`([^`]+)`/gm)].map(([, name]) => name);
}

/**
 * Throws, naming them, when files in three.js's `examples/jsm/libs` have no row in
 * THIRD-PARTY-NOTICES.md's three.js libraries table. A row names a file, or a folder ending in `/`.
 */
export function assertThreeLibsListed(libsDir, markdown) {
  const listed = listedThreeLibs(markdown);
  const covered = (file) => listed.some((name) => (name.endsWith("/") ? file.startsWith(name) : file === name));
  const files = fs.readdirSync(libsDir, { recursive: true }).map((file) => String(file).split(path.sep).join("/"));
  const missing = files.filter((file) => fs.statSync(path.join(libsDir, file)).isFile() && !covered(file));
  if (missing.length > 0) {
    throw new Error(
      `three.js libraries missing from THIRD-PARTY-NOTICES.md ("${THREE_LIBS_HEADING}"): ${missing.join(", ")}`,
    );
  }
}
