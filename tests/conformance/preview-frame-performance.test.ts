import assert from "node:assert/strict";
import { test } from "node:test";
import { PreviewService } from "../../src/main/core/previews.ts";
import { unservedPreviews, type CoreInternals } from "../../src/main/core/internals.ts";
import type { StudioCore } from "../../src/main/studio-core.ts";
import type { PreviewPort } from "../../src/substrate/preview-port.ts";
import type { AgentScreen } from "../../src/shared/agent-screen.ts";

test("card frames use the lightweight resized capture without full stats or a JPEG round trip", async () => {
  const calls: string[] = [];
  const port = {
    screenshotCard: async () => {
      calls.push("card");
      return Buffer.from("card");
    },
    screenshotWithStats: async () => {
      calls.push("full");
      return { jpeg: Buffer.from("large"), stats: { meanLuma: 100, litFraction: 1 } };
    },
    resizeImage: async () => {
      calls.push("resize");
      return Buffer.from("small");
    },
  } as unknown as PreviewPort;
  const events: unknown[] = [];
  const core = { emit: (_type: unknown, frame: unknown) => events.push(frame) } as unknown as StudioCore;
  const service = new PreviewService(core, unservedPreviews() as CoreInternals);
  const screen: AgentScreen = {
    handle: "frame-test",
    project: "p",
    label: "worker",
    runId: null,
    facetId: null,
    role: "builder",
  };
  await service.frame(port, screen, null, "look");
  assert.deepEqual(calls, ["card"]);
  assert.equal(events.length, 1);
});

test("repeated card requests share one trailing capture and a closed screen cannot reappear", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let captures = 0;
  const port = {
    screenshotCard: async () => {
      captures++;
      return Buffer.from("card");
    },
  } as unknown as PreviewPort;
  const core = { emit: () => {} } as unknown as StudioCore;
  const service = new PreviewService(core, unservedPreviews() as CoreInternals);
  const screen: AgentScreen = {
    handle: "coalesce",
    project: "p",
    label: "worker",
    runId: null,
    facetId: null,
    role: "builder",
  };
  await service.frame(port, screen, null, "one");
  await service.frame(port, screen, null, "two");
  await service.frame(port, screen, null, "three");
  assert.equal(captures, 1);
  t.mock.timers.tick(1000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(captures, 2);
  assert.equal(service.agentScreens()[0]?.caption, "three");
  await service.frame(port, screen, null, "closed");
  service.closeScreen(screen.handle);
  t.mock.timers.tick(1000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(captures, 2);
  assert.deepEqual(service.agentScreens(), []);
});
