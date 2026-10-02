import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codexSessionMetadata } from "../../src/substrate/engines/codex-session.ts";
it("uses only exact-session model/version metadata; absent or mismatched metadata remains unknown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-model-"));
  const now = Date.now(),
    id = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  const dir = path.join(root, "sessions", new Date(now).toISOString().slice(0, 10).replaceAll("-", path.sep));
  try {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `rollout-test-${id}.jsonl`);
    await writeFile(
      file,
      [
        { type: "session_meta", payload: { id, cli_version: "0.153.3" } },
        { type: "turn_context", payload: { model: "reported-model" } },
      ]
        .map((x) => JSON.stringify(x))
        .join("\n"),
    );
    assert.deepEqual(await codexSessionMetadata(root, id, now), { model: "reported-model", cliVersion: "0.153.3" });
    assert.deepEqual(await codexSessionMetadata(root, other, now), {});
    await writeFile(file, JSON.stringify({ type: "session_meta", payload: { id: other, cli_version: "incorrect" } }));
    assert.deepEqual(await codexSessionMetadata(root, id, now), {});
    await writeFile(file, "malformed");
    assert.deepEqual(await codexSessionMetadata(root, id, now), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("retains a native compaction boundary when later token counts arrive between metadata polls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-compact-"));
  const now = Date.now(),
    id = "33333333-3333-4333-8333-333333333333",
    at = new Date(now).toISOString();
  const dir = path.join(root, "sessions", at.slice(0, 10).replaceAll("-", path.sep));
  try {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `rollout-${id}.jsonl`);
    const rows = [
      { type: "session_meta", payload: { id } },
      { type: "compacted", timestamp: at, payload: { message: "checkpoint" } },
    ];
    await writeFile(file, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const before = await codexSessionMetadata(root, id, now);
    assert.equal(before.context?.compacted, true);
    assert.ok(before.lastCompaction?.id);
    await appendFile(
      file,
      JSON.stringify({
        type: "event_msg",
        timestamp: at,
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 24299 }, model_context_window: 258000 },
        },
      }) + "\n",
    );
    const after = await codexSessionMetadata(root, id, now);
    assert.deepEqual(after.lastCompaction, before.lastCompaction);
    assert.equal(after.context?.promptTokens, 24299);
    assert.equal(after.context?.compacted, undefined);
    assert.equal(after.context?.lastCompactedAt, at);
    await appendFile(file, JSON.stringify(rows[1]) + "\n");
    assert.notEqual(
      (await codexSessionMetadata(root, id, now)).lastCompaction?.id,
      before.lastCompaction?.id,
      "distinct boundaries with the same timestamp retain distinct identities",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
