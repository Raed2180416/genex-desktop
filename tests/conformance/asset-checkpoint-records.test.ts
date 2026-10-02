/**
 * Delivery records are only "none yet" when the record file does not exist. A read that fails for
 * any other reason (permissions, I/O) used to read as `[]`, and the next delivery then replaced
 * every earlier record with its single entry.
 */
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { AssetCheckpoints, type AssetDeliveryRecord } from "../../src/main/asset-checkpoints.ts";
import { tmpDir } from "../helpers/tmp.ts";

async function workspace() {
  const root = await tmpDir("studio-asset-records-");
  const game = path.join(root, "game");
  await mkdir(path.join(game, "assets"), { recursive: true });
  await writeFile(path.join(game, "assets", "crate.glb"), "glb");
  return { root, game, file: path.join(root, "host-deliveries.json") };
}

describe("asset delivery records", () => {
  it("a missing record file reads as no records", async () => {
    const { game, file } = await workspace();
    const checkpoints = new AssetCheckpoints(file);
    assert.deepEqual(await checkpoints.records(), []);
    await checkpoints.record("game", game, "genex", "job-1", ["assets/crate.glb"]);
    assert.equal((await checkpoints.records()).length, 1);
  });

  it("an unreadable record file fails the delivery instead of replacing earlier records", async (t) => {
    if (process.getuid?.() === 0) {
      t.skip("root reads files regardless of their mode");
      return;
    }
    // The elevated Windows runner read the file past both a deny entry and an exclusive lock;
    // the folder case below holds this rule on every platform.
    if (process.platform === "win32") {
      t.skip("a Windows file stays readable to its elevated owner");
      return;
    }
    const { game, file } = await workspace();
    const earlier: AssetDeliveryRecord[] = [
      { id: "r1", project: "game", workspace: game, plugin: "genex", jobId: "j1", files: [] },
      { id: "r2", project: "game", workspace: game, plugin: "genex", jobId: "j2", files: [] },
    ];
    await writeFile(file, JSON.stringify(earlier));
    const before = await readFile(file, "utf8");
    await chmod(file, 0o000);
    try {
      const checkpoints = new AssetCheckpoints(file);
      await assert.rejects(checkpoints.records(), /EACCES|permission/i);
      await assert.rejects(
        checkpoints.record("game", game, "genex", "job-3", ["assets/crate.glb"]),
        /EACCES|permission/i,
      );
    } finally {
      await chmod(file, 0o600);
    }
    assert.equal(await readFile(file, "utf8"), before, "earlier delivery records are intact");
  });

  it("a record path that is a folder fails the delivery and is left as it was", async () => {
    const { game, file } = await workspace();
    await mkdir(file);
    const checkpoints = new AssetCheckpoints(file);
    await assert.rejects(checkpoints.records(), /EISDIR/);
    await assert.rejects(checkpoints.record("game", game, "genex", "job-3", ["assets/crate.glb"]), /EISDIR/);
    assert.ok((await stat(file)).isDirectory(), "nothing replaced the unreadable records");
  });
});
