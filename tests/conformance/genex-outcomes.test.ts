import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordGenexUse } from "../../src/substrate/genex-outcomes.ts";
import type { AudioPlaybackEvidence } from "../../src/shared/audio-observation.ts";
import type { GenexJob } from "../../src/shared/genex.ts";

it("requires runtime loading and a matching visual inspection before recording observed use", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-genex-use-"));
  const job: GenexJob = {
    id: "fixture",
    project: "fixture",
    operation: "image",
    status: "downloaded",
    files: ["assets/banner.png"],
    createdAt: new Date().toISOString(),
  };
  const base = { job, dir, root: dir, signal: new AbortController().signal };
  const verify = { operation: "verify_use", prompt: "The generated banner is visible above the doorway." };
  try {
    await assert.rejects(recordGenexUse({ ...base, request: verify }), /fresh inspection/);
    await recordGenexUse({
      ...base,
      request: { operation: "inspect_use" },
      observe: async () => ({ image: Buffer.from("fixture frame"), loadedFiles: [], consoleAvailable: false }),
    });
    assert.equal(job.use?.stage, "unconfirmed");
    assert.equal(job.use?.consoleAvailable, false);
    await assert.rejects(
      recordGenexUse({ ...base, request: { ...verify, options: { inspectionId: job.use!.inspectionId } } }),
      /fresh inspection/,
    );
    await recordGenexUse({
      ...base,
      request: { operation: "inspect_use" },
      observe: async () => ({ image: Buffer.from("fixture frame"), loadedFiles: job.files, consoleAvailable: true }),
    });
    assert.equal(job.use?.stage, "integrated");
    await assert.rejects(
      recordGenexUse({ ...base, request: { ...verify, options: { inspectionId: "stale" } } }),
      /current host inspection/,
    );
    await recordGenexUse({ ...base, request: { ...verify, options: { inspectionId: job.use!.inspectionId } } });
    const saved = JSON.parse(await readFile(path.join(dir, "job.json"), "utf8"));
    assert.equal(saved.use.stage, "verified");
    assert.equal(saved.use.verification, "agent-visual-observation");
    assert.equal(saved.creditsCharged, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("does not equate an audio download, unavailable observation, or stopped inspection with verified playback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-genex-audio-"));
  const job: GenexJob = {
    id: "fixture",
    project: "fixture",
    operation: "sfx",
    status: "generated",
    files: [],
    createdAt: new Date().toISOString(),
  };
  const base = { job, dir, root: dir, signal: new AbortController().signal, request: { operation: "inspect_use" } };
  try {
    await assert.rejects(recordGenexUse(base), /Retrieve and deliver/);
    job.files = ["assets/chime.mp3"];
    job.status = "downloaded";
    await assert.rejects(recordGenexUse(base), /unavailable/);
    const controller = new AbortController();
    controller.abort();
    let observed = false;
    const observe = async () => {
      observed = true;
      return { image: Buffer.from("fixture"), loadedFiles: job.files, consoleAvailable: true };
    };
    await assert.rejects(recordGenexUse({ ...base, signal: controller.signal, observe }), { name: "AbortError" });
    assert.equal(observed, false);
    await recordGenexUse({ ...base, observe });
    assert.equal(job.use?.verification, "unavailable-audio");
    await assert.rejects(
      recordGenexUse({
        ...base,
        request: {
          operation: "verify_use",
          options: { inspectionId: job.use!.inspectionId },
          prompt: "The chime is audible in this frame.",
        },
      }),
      /Audio playback/,
    );
    assert.equal(job.use?.stage, "integrated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("only verifies matching non-silent advancing audio evidence, never a different file or mixed visual job", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-audio-evidence-"));
  const job: GenexJob = {
    id: "audio",
    project: "fixture",
    operation: "sfx",
    status: "downloaded",
    files: ["assets/a.wav"],
    createdAt: new Date().toISOString(),
  };
  try {
    const inspect = async (audio: AudioPlaybackEvidence[]) =>
      recordGenexUse({
        job,
        dir,
        root: dir,
        request: { operation: "inspect_use" },
        signal: new AbortController().signal,
        observe: async () => ({ image: Buffer.from("frame"), loadedFiles: job.files, consoleAvailable: true, audio }),
      });
    const playing: AudioPlaybackEvidence = {
      file: "assets/a.wav",
      state: "playing",
      rms: 0.1,
      advancedSeconds: 0.5,
      detail: "measured",
    };
    for (const state of ["muted", "paused", "failed", "silent", "unavailable"] as const) {
      await inspect([{ ...playing, state }]);
      assert.notEqual(job.use?.stage, "verified");
    }
    for (const bad of [{ file: "assets/other.wav" }, { rms: 0 }, { rms: NaN }, { advancedSeconds: 0 }]) {
      await inspect([{ ...playing, ...bad }]);
      assert.notEqual(job.use?.stage, "verified");
    }
    await inspect([playing]);
    assert.equal(job.use?.verification, "runtime-audio-playback");
    assert.equal(job.use?.stage, "verified");
    job.files.push("assets/image.png");
    await inspect([playing]);
    assert.notEqual(job.use?.stage, "verified");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
