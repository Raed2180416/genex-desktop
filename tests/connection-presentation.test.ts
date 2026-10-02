import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionReadiness, connectionHeadline } from "../src/renderer/connection-presentation.ts";
import { rowAccountStep } from "../src/renderer/panels/plugins/labels.ts";
const base = { id: "asset", name: "Assets", kind: "plugin" as const, enabled: true, health: "ready", tools: 3 };
test("healthy backend with locked account needs attention, not ready language", () => {
  assert.equal(connectionReadiness({ ...base, account: "locked" }), "needs attention");
  assert.equal(
    connectionHeadline([
      { ...base, account: "locked" },
      { ...base, id: "blender", health: "idle" },
    ]),
    "2 tool sources enabled · 1 needs attention",
  );
});
test("lazy plugin and unlocked account do not certify runtime or spending readiness", () => {
  assert.equal(connectionReadiness({ ...base, health: "idle" }), "not checked");
  assert.equal(connectionReadiness({ ...base, account: "unlocked" }), "not checked");
  assert.match(connectionHeadline([{ ...base, account: "unlocked" }]), /permissions checked when used/);
});
test("disabled sources do not count and failed enabled connectors stay actionable", () => {
  assert.equal(
    connectionHeadline([{ ...base, enabled: false }]),
    "0 tool sources enabled · permissions checked when used",
  );
  assert.equal(connectionReadiness({ ...base, kind: "mcp", health: "failed" }), "needs attention");
  assert.equal(connectionReadiness({ ...base, kind: "mcp", health: "ready" }), "connected");
});

test("a plugin row's account asks for one thing: a locked saved sign-in reads as Connect, like no account yet", () => {
  assert.equal(rowAccountStep("locked"), "connect");
  assert.equal(rowAccountStep("not connected"), "connect");
  assert.equal(rowAccountStep("failed"), "reconnect");
  assert.equal(rowAccountStep("authorizing"), "finishing");
  assert.equal(rowAccountStep("unlocked"), "connected");
  assert.equal(rowAccountStep(undefined), "checking");
});
