import assert from "node:assert/strict";
import { it } from "node:test";
import { setImmediate as nextTurn, setTimeout } from "node:timers/promises";
import { coreLite } from "../helpers/core-lite.ts";
import { HostMethod } from "../../src/shared/harness-api.ts";
import { DispatchActionType } from "../../src/shared/protocol.ts";

it("Stop aborts direct completions before a wedged harness acknowledges cancellation", async () => {
  const { core } = await coreLite();
  let signal: AbortSignal | undefined;
  let release: (() => void) | undefined;
  const provider = new Promise<void>((resolve) => {
    release = resolve;
  });
  core.engines.register({
    id: "stop-fixture",
    label: "Fixture",
    kind: "direct",
    status: async () => ({ code: "ready", detail: "Fixture" }),
    models: async () => [],
    complete: async (request) => {
      signal = request.signal;
      await provider;
      return {
        message: { role: "assistant", content: "" },
        usage: {},
        model: "fixture",
        engine: "stop-fixture",
        stopReason: "stop",
      };
    },
  });
  const completing = core
    .api()
    [HostMethod.EngineComplete]({ engine: "stop-fixture", threadId: core.mainThread, stream: false, messages: [] });
  while (!signal) await nextTurn();
  let acknowledge: (() => void) | undefined;
  core.host.dispatch = async (action) => {
    assert.equal(action.type, DispatchActionType.Cancel);
    await new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
  };
  const stopping = core.stopThread(core.mainThread, { resumeQueue: false });
  try {
    while (!acknowledge) await nextTurn();
    await nextTurn();
    assert.equal(signal.aborted, true, "the provider is stopped while the harness is still wedged");
  } finally {
    acknowledge?.();
    release?.();
    await Promise.all([stopping, completing]);
  }
});

it("Stop aborts provider work even while a message to a wedged harness is still sending (B3)", async () => {
  const { core } = await coreLite({ stopSendWaitMs: 200 });
  let signal: AbortSignal | undefined;
  let release: (() => void) | undefined;
  const provider = new Promise<void>((resolve) => {
    release = resolve;
  });
  core.engines.register({
    id: "stop-fixture",
    label: "Fixture",
    kind: "direct",
    status: async () => ({ code: "ready", detail: "Fixture" }),
    models: async () => [],
    complete: async (request) => {
      signal = request.signal;
      await provider;
      return {
        message: { role: "assistant", content: "" },
        usage: {},
        model: "fixture",
        engine: "stop-fixture",
        stopReason: "stop",
      };
    },
  });
  const completing = core
    .api()
    [HostMethod.EngineComplete]({ engine: "stop-fixture", threadId: core.mainThread, stream: false, messages: [] });
  while (!signal) await nextTurn();
  // The harness takes neither the message nor the cancel: its dispatches never answer.
  let unwedge: (() => void) | undefined;
  const wedged = new Promise<void>((resolve) => {
    unwedge = resolve;
  });
  core.host.dispatch = async () => {
    await wedged;
  };
  const sending = core.sendUserMessage("one more thing").catch(() => {});
  await nextTurn();
  const stopping = core.stopThread(core.mainThread, { resumeQueue: false });
  try {
    const until = Date.now() + 5_000;
    while (!signal.aborted && Date.now() < until) await setTimeout(20);
    assert.equal(signal.aborted, true, "the provider is stopped though the send never reached the queue");
  } finally {
    unwedge?.();
    release?.();
    await Promise.all([stopping, completing, sending]);
  }
});
