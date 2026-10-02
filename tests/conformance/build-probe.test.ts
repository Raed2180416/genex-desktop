/**
 * The build probe's verdicts, driven through the same FakePreview the rig uses — the pixel
 * check and the frame check must cover for each other exactly as the contract says.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { observeBuild } from "../../src/substrate/build-probe.ts";
import { makeFakePreview } from "../helpers/studio-rig.ts";

describe("build probe", () => {
  it("passes a lit canvas whose frame advances", async () => {
    const preview = makeFakePreview();
    const observation = await observeBuild(preview);
    assert.equal(observation.ok, true);
    assert.deepEqual(observation.reasons, []);
    assert.equal(observation.frameAdvanced, true);
    assert.equal(observation.studioMissing, false);
    assert.equal(observation.pixels?.litFraction, 0.6);
  });

  it("fails a black canvas even though the simulation runs", async () => {
    const preview = makeFakePreview();
    preview.pixelStatsNext = { ...preview.pixelStatsNext, litFraction: 0.001 };
    const observation = await observeBuild(preview);
    assert.equal(observation.ok, false);
    assert.match(observation.reasons.join("; "), /black canvas/);
    assert.equal(observation.frameAdvanced, true);
  });

  it("fails a lit canvas whose frame counter never moves", async () => {
    const preview = makeFakePreview();
    preview.studioCall = async (method, arg) => {
      preview.calls.push({ method, arg });
      return { ok: true };
    };
    const observation = await observeBuild(preview);
    assert.equal(observation.ok, false);
    assert.match(observation.reasons.join("; "), /stuck at 0/);
    assert.equal(observation.frameAdvanced, false);
  });

  it("tolerates a missing studio contract when the screen is alive", async () => {
    const preview = makeFakePreview();
    preview.next = { __missing: true };
    const observation = await observeBuild(preview);
    assert.equal(observation.ok, true);
    assert.equal(observation.studioMissing, true);
    // Missing contract means nothing to step — the probe must not have tried.
    assert.deepEqual(preview.calls, []);
  });

  it("fails a black canvas regardless of the studio contract", async () => {
    const preview = makeFakePreview();
    preview.next = { __missing: true };
    preview.pixelStatsNext = { ...preview.pixelStatsNext, litFraction: 0 };
    const observation = await observeBuild(preview);
    assert.equal(observation.ok, false);
    assert.match(observation.reasons.join("; "), /black canvas/);
  });

  it("passes without a pixel verdict when the preview cannot capture stats", async () => {
    const preview = makeFakePreview();
    delete preview.screenshotWithStats;
    const observation = await observeBuild(preview);
    assert.equal(observation.ok, true);
    assert.equal(observation.pixels, null);
    assert.equal(observation.frameAdvanced, true);
  });
});
