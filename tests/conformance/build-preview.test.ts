import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { latestBuildPreview } from "../../src/substrate/build-preview.ts";
test("saved capture lookup chooses newest capture, prefers default camera, and contains paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "build-preview-"));
  try {
    const dir = path.join(root, "run_x/facet_river/self/iter_001");
    await mkdir(dir, { recursive: true });
    for (const name of ["c1_default.jpg", "c2_bridge.jpg", "c2_default.jpg"])
      await writeFile(path.join(dir, name), "fixture");
    const request = { runId: "run_x", facetId: "river", iteration: 1 };
    const frame = await latestBuildPreview(root, request);
    assert.equal(path.basename(frame!.path), "c2_default.jpg");
    assert.ok(Number.isFinite(Date.parse(frame!.capturedAt)));
    assert.equal(await latestBuildPreview(root, { ...request, runId: "../escape" }), null);
    assert.equal(await latestBuildPreview(root, { ...request, facetId: "../escape" }), null);
    assert.equal(await latestBuildPreview(root, { ...request, iteration: -1 }), null);
    assert.equal(await latestBuildPreview(root, { ...request, iteration: 2 }), null);
    const outside = await mkdtemp(path.join(os.tmpdir(), "preview-outside-"));
    try {
      await writeFile(path.join(outside, "frame.jpg"), "outside");
      await symlink(path.join(outside, "frame.jpg"), path.join(dir, "c9_default.jpg"));
      assert.equal(path.basename((await latestBuildPreview(root, request))!.path), "c2_default.jpg");
      await symlink(outside, path.join(root, "escaped"));
      assert.equal(await latestBuildPreview(root, { ...request, runId: "escaped" }), null);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
