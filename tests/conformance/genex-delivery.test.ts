import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { deliverGenexFiles } from "../../src/substrate/genex-delivery.ts";
it("delivers real files without overwriting existing files or following game/output symlinks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-delivery-"));
  try {
    const game = path.join(dir, "game"),
      out = path.join(dir, "out");
    await mkdir(game);
    await mkdir(out);
    await writeFile(path.join(out, "asset.png"), "real output");
    const id = randomUUID(),
      files = await deliverGenexFiles(out, game, id);
    assert.equal(await readFile(path.join(game, files[0]!), "utf8"), "real output");
    await assert.rejects(deliverGenexFiles(out, game, id), /EEXIST/);
    await symlink(path.join(dir, "out"), path.join(out, "escape"));
    await assert.rejects(deliverGenexFiles(out, game, randomUUID()), /symlink/);
    const other = path.join(dir, "other");
    await mkdir(other);
    await symlink(out, path.join(other, "assets"));
    await assert.rejects(deliverGenexFiles(out, other, randomUUID()), /symlink/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
