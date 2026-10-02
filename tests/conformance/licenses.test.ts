/**
 * Settings → Licenses reads the license texts the build shipped: Genex's own MIT license, the
 * generated list of bundled packages and the project's third-party notices, from fixed files in
 * the app's resources. A build that wrote none of them (a watch build) shows what exists. Drives
 * src/main/licenses.ts against the files scripts/third-party-notices.mjs writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp.ts";
import { readLicenseTexts } from "../../src/main/licenses.ts";
import { writeBundledNotices } from "../../scripts/third-party-notices.mjs";
import { unwrapMarkdown } from "../../src/renderer/licenses-text.ts";

test("reads the license, the bundled list and the notices the build writes into resources", async () => {
  const root = await tmpDir("licenses-");
  await writeFile(path.join(root, "LICENSE"), "MIT License\n\nCopyright (c) 2026 genex.games\n");
  await writeFile(path.join(root, "THIRD-PARTY-NOTICES.md"), "# Third-party notices\n\n## three.js\n");
  await mkdir(path.join(root, "src/renderer/ui"), { recursive: true });
  await writeFile(path.join(root, "src/renderer/ui/GENEX-SOURCES.md"), "# Genex UI provenance\n");
  const dist = path.join(root, "dist");
  await writeBundledNotices({ root, dist, inputs: [] });

  const texts = await readLicenseTexts(path.join(dist, "resources"));
  assert.equal(texts.license, "MIT License\n\nCopyright (c) 2026 genex.games\n");
  assert.match(texts.bundled ?? "", /^# Bundled third-party software/);
  assert.equal(texts.notices, "# Third-party notices\n\n## three.js\n");
});

test("a build without the files reads them as missing instead of failing", async () => {
  const resources = await tmpDir("licenses-empty-");
  assert.deepEqual(await readLicenseTexts(resources), { license: null, bundled: null, notices: null });
});

test("a resources path that is not a folder still fails loudly", async () => {
  const resources = path.join(await tmpDir("licenses-file-"), "resources");
  await writeFile(resources, "not a folder");
  await assert.rejects(readLicenseTexts(resources), /ENOTDIR/);
});

test("the notices read as flowing paragraphs: wrapped lines join, blocks and fenced texts stay", () => {
  const markdown = [
    "# Notices",
    "",
    "A paragraph wrapped",
    "across two lines.",
    "",
    "- A list item wrapped",
    "  onto an indented line",
    "- The next item",
    "  - A nested item",
    "",
    "| File | License |",
    "| --- | --- |",
    "",
    "```",
    "MIT License",
    "Copyright (c) 2026",
    "```",
    "## After",
    "Text under a heading",
    "keeps its own paragraph.",
  ].join("\n");
  assert.equal(
    unwrapMarkdown(markdown),
    [
      "# Notices",
      "",
      "A paragraph wrapped across two lines.",
      "",
      "- A list item wrapped onto an indented line",
      "- The next item",
      "  - A nested item",
      "",
      "| File | License |",
      "| --- | --- |",
      "",
      "```",
      "MIT License",
      "Copyright (c) 2026",
      "```",
      "## After",
      "Text under a heading keeps its own paragraph.",
    ].join("\n"),
  );
});
