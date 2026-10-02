/**
 * The build ships every third-party license it owes: each npm package bundled into the app's
 * JavaScript or compiled into its stylesheet keeps its own license files beside NOTICE.md, a
 * package that ships none must have its notice in THIRD-PARTY-NOTICES.md, and every library in
 * three.js's vendored `examples/jsm/libs` must be listed there. A gap stops the build instead of
 * shipping code without its license. Drives scripts/third-party-notices.mjs, which build.mjs calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp.ts";
import { assertThreeLibsListed, stylesheetPackages, writeBundledNotices } from "../../scripts/third-party-notices.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");

/** A project root with an installed package per entry: name → files beside its package.json. */
async function project(packages: Record<string, Record<string, string>>, notices = "# Third-party notices\n") {
  const root = await tmpDir("notices-");
  for (const [name, files] of Object.entries(packages)) {
    const dir = path.join(root, "node_modules", name);
    await mkdir(path.join(dir, "dist"), { recursive: true });
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT" }));
    await writeFile(path.join(dir, "dist/index.js"), "export {};\n");
    for (const [file, text] of Object.entries(files)) await writeFile(path.join(dir, file), text);
  }
  await writeFile(path.join(root, "THIRD-PARTY-NOTICES.md"), notices);
  await writeFile(path.join(root, "LICENSE"), "MIT License\n");
  await mkdir(path.join(root, "src/renderer/ui"), { recursive: true });
  await writeFile(path.join(root, "src/renderer/ui/GENEX-SOURCES.md"), "# Genex UI provenance\n");
  return { root, dist: path.join(root, "dist") };
}

test("a bundled package's own license files ship beside the notice list", async () => {
  const { root, dist } = await project({ "with-license": { LICENSE: "MIT License\nCopyright (c) Someone\n" } });
  await writeBundledNotices({ root, dist, inputs: ["node_modules/with-license/dist/index.js", "src/main.ts"] });
  const third = path.join(dist, "resources/third-party");
  assert.equal(
    await readFile(path.join(third, "with-license@1.0.0/LICENSE"), "utf8"),
    "MIT License\nCopyright (c) Someone\n",
  );
  assert.match(await readFile(path.join(third, "NOTICE.md"), "utf8"), /^- with-license 1\.0\.0: MIT; LICENSE$/m);
});

test("the packages a stylesheet imports by name are bundle inputs; its own files are not", () => {
  const css = [
    '@import "tailwindcss";',
    "@import '@xterm/xterm/css/xterm.css';",
    '@import "tw-animate-css";',
    '@import "./styles/icons.css";',
    '@import "../shared.css";',
  ].join("\n");
  assert.deepEqual(stylesheetPackages(css), [
    "node_modules/tailwindcss/package.json",
    "node_modules/@xterm/xterm/package.json",
    "node_modules/tw-animate-css/package.json",
  ]);
});

test("a package without a license file is listed against the section THIRD-PARTY-NOTICES.md gives it", async () => {
  const { root, dist } = await project(
    { "bare-package": {} },
    "# Third-party notices\n\n## bare-package 1.0.0\n\nMIT License\n",
  );
  await writeBundledNotices({ root, dist, inputs: ["node_modules/bare-package/dist/index.js"] });
  const list = await readFile(path.join(dist, "resources/third-party/NOTICE.md"), "utf8");
  assert.match(list, /^- bare-package 1\.0\.0: MIT; notice in PROJECT-SOURCES\.md$/m);
});

test("a package with neither a license file nor a notice section stops the build and writes nothing", async () => {
  const { root, dist } = await project({ "bare-package": {}, "with-license": { LICENSE: "MIT License\n" } });
  await assert.rejects(
    writeBundledNotices({
      root,
      dist,
      inputs: ["node_modules/with-license/dist/index.js", "node_modules/bare-package/dist/index.js"],
    }),
    (error: Error) => error.message.includes("bare-package") && !error.message.includes("with-license"),
  );
  assert.equal(existsSync(path.join(dist, "resources/third-party")), false);
});

test("a section heading only covers the package it names, not one whose name contains it", async () => {
  const { root, dist } = await project({ "bare-package-extra": {} }, "# Notices\n\n## bare-package 1.0.0\n");
  await assert.rejects(
    writeBundledNotices({ root, dist, inputs: ["node_modules/bare-package-extra/dist/index.js"] }),
    /bare-package-extra/,
  );
});

test("every library three.js vendors in examples/jsm/libs needs a row in the three.js libraries table", async () => {
  const libs = await tmpDir("three-libs-");
  await mkdir(path.join(libs, "draco/gltf"), { recursive: true });
  await writeFile(path.join(libs, "draco/gltf/draco_decoder.js"), "");
  await writeFile(path.join(libs, "tween.module.js"), "");
  await writeFile(path.join(libs, "brand-new.module.js"), "");
  const notices = [
    "## three.js add-on libraries",
    "",
    "| File | Project | License |",
    "| --- | --- | --- |",
    "| `draco/` | Draco | Apache-2.0 |",
    "| `tween.module.js` | tween.js | MIT |",
    "",
    "## Something else",
    "",
    "| `brand-new.module.js` | not this table | MIT |",
  ].join("\n");
  assert.throws(
    () => assertThreeLibsListed(libs, notices),
    (error: Error) => /brand-new\.module\.js/.test(error.message),
  );
  assert.doesNotThrow(() =>
    assertThreeLibsListed(
      libs,
      notices.replace("| `tween.module.js`", "| `brand-new.module.js` | New | MIT |\n| `tween.module.js`"),
    ),
  );
});

test("the installed three.js libraries and stylesheet packages are all covered today", async () => {
  const notices = await readFile(path.join(REPO, "THIRD-PARTY-NOTICES.md"), "utf8");
  assert.doesNotThrow(() => assertThreeLibsListed(path.join(REPO, "node_modules/three/examples/jsm/libs"), notices));
  const css = await readFile(path.join(REPO, "src/renderer/theme.css"), "utf8");
  for (const manifest of stylesheetPackages(css)) assert.ok(existsSync(path.join(REPO, manifest)), manifest);
});
