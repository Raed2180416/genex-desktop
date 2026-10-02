import assert from "node:assert/strict";
import { test } from "node:test";
import { SelfImprovementService } from "../../src/main/core/self-improvement.ts";
import type { StudioCore } from "../../src/main/studio-core.ts";
import type { CoreInternals } from "../../src/main/core/internals.ts";

test("historical change diffs stay bounded and recently used entries survive", async () => {
  let reads = 0;
  const core = {
    snapshots: {
      patch: async () => {
        reads++;
        return "diff";
      },
    },
  };
  const changeDiffs = new Map<string, string>();
  const service = new SelfImprovementService(
    core as unknown as StudioCore,
    { changeDiffs } as unknown as CoreInternals,
  );
  for (let id = 0; id < 32; id++) await service.changeDiff(`${id}`, "to", []);
  await service.changeDiff("0", "to", []);
  await service.changeDiff("32", "to", []);
  assert.equal(changeDiffs.size, 32);
  const previous = reads;
  await service.changeDiff("0", "to", []);
  assert.equal(reads, previous);
  await service.changeDiff("1", "to", []);
  assert.equal(reads, previous + 1);
});
