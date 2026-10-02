import { test } from "node:test";
import assert from "node:assert/strict";
import { stoppedDownload } from "../../src/renderer/model-download.ts";
import { InstallPhase, type ModelInstallJob } from "../../src/shared/model-install.ts";

const model = "bonsai-2:27b-pq2_0";
const failed: ModelInstallJob = {
  id: "j",
  model,
  phase: InstallPhase.Failed,
  completed: 6_375_170_568,
  total: 7_846_926_676,
  location: "/models",
  updatedAt: "2026-10-01T15:18:11.144Z",
  error: "Lost the connection to the download server.",
  active: false,
};

test("a download that stopped with saved bytes offers Resume on its own row, with how much is saved and why", () => {
  assert.deepEqual(stoppedDownload(failed, model), {
    resumable: true,
    percent: 81,
    reason: failed.error,
    cancelled: false,
  });
  assert.equal(stoppedDownload(failed, "bonsai-2:27b-ptq1_0"), null, "another model's row stays as it was");
  const interrupted = { ...failed, phase: InstallPhase.Interrupted };
  assert.equal(stoppedDownload(interrupted, model)?.resumable, true, "closing Studio mid-download keeps the bytes");
  const cancelled = { ...failed, phase: InstallPhase.Cancelled };
  assert.equal(stoppedDownload(cancelled, model)?.cancelled, true);
});

test("a download that saved nothing, still runs, or finished has nothing to resume", () => {
  assert.equal(stoppedDownload(null, model), null);
  const refused = { ...failed, completed: 0, error: "Not enough space" };
  assert.deepEqual(stoppedDownload(refused, model), {
    resumable: false,
    percent: 0,
    reason: "Not enough space",
    cancelled: false,
  });
  assert.equal(stoppedDownload({ ...failed, phase: InstallPhase.Downloading, active: true }, model), null);
  assert.equal(stoppedDownload({ ...failed, phase: InstallPhase.Ready, error: undefined }, model), null);
  const almost = { ...failed, completed: failed.total - 1 };
  assert.equal(stoppedDownload(almost, model)?.percent, 99, "never rounds an unfinished download up to 100%");
});
