import assert from "node:assert/strict";
import { it } from "node:test";
import { multiplayerReadiness } from "../../src/main/core/generation-prerequisites.ts";

it("refuses multiplayer before delegation when its account or hosted route is unavailable", () => {
  const ready = { manifest: true, install: true, publish: true, account: "unlocked" };
  assert.equal(multiplayerReadiness(ready).ready, true);
  for (const facts of [
    { ...ready, manifest: false },
    { ...ready, install: false },
    { ...ready, publish: false },
    { ...ready, account: "locked" },
  ])
    assert.equal(multiplayerReadiness(facts).ready, false);
  assert.equal(multiplayerReadiness(ready).hostedVerified, false, "capability readiness is not a multiplayer pass");
});
