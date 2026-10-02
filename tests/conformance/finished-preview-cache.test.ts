import assert from "node:assert/strict";
import test from "node:test";
import { readRoundPreview } from "../../src/renderer/panels/run-stills.ts";
import { fakeStudioApi, installFakeStudio } from "../helpers/fake-studio-api.ts";

test("finished preview cache reuses successful answers but refreshes active and missing frames", async () => {
  let reads = 0;
  let missing = false;
  const restore = installFakeStudio(
    fakeStudioApi({
      buildPreview: async () => {
        reads++;
        return missing ? null : { path: "frame.jpg", camera: "default", capturedAt: String(reads) };
      },
    }),
  );
  const request = { runId: "cache-answers", facetId: "facet", iteration: 1 };
  try {
    assert.strictEqual(await readRoundPreview(request, false), await readRoundPreview(request, false));
    assert.equal(reads, 1);
    await readRoundPreview(request, true);
    await readRoundPreview(request, true);
    assert.equal(reads, 3);
    missing = true;
    await readRoundPreview(request, false);
    await readRoundPreview(request, false);
    assert.equal(reads, 5);
    missing = false;
    await readRoundPreview(request, false);
    await readRoundPreview(request, false);
    assert.equal(reads, 6);
  } finally {
    restore();
  }
});

test("finished preview cache evicts old answers after bounded retention", async () => {
  let reads = 0;
  const restore = installFakeStudio(
    fakeStudioApi({
      buildPreview: async () => {
        reads++;
        return { path: "frame.jpg", camera: "default", capturedAt: "same" };
      },
    }),
  );
  const request = (iteration: number) => ({ runId: "cache-eviction", facetId: "facet", iteration });
  try {
    for (let index = 0; index < 160; index++) await readRoundPreview(request(index), false);
    await readRoundPreview(request(0), false);
    assert.equal(reads, 161);
    await readRoundPreview(request(159), false);
    assert.equal(reads, 161);
  } finally {
    restore();
  }
});
