import assert from "node:assert/strict";
import test from "node:test";
import { PerformanceRecorder } from "../../src/main/performance.ts";

test("disabled diagnostics never serialize pushed data", () => {
  const recorder = new PerformanceRecorder(false, () => 0);
  recorder.push("frame", {
    toJSON() {
      throw new Error("must not serialize");
    },
  });
  assert.deepEqual(recorder.snapshot().channels, {});
});
test("diagnostic counters and startup marks use injected time and bounded histograms", () => {
  let now = 10;
  const recorder = new PerformanceRecorder(true, () => now);
  now = 20;
  recorder.mark("ready");
  now = 30;
  recorder.mark("ready");
  recorder.record("invoke:summary", 20, 8);
  recorder.record("invoke:summary", 2, 12);
  const result = recorder.snapshot();
  assert.equal(result.marks.ready, 10);
  // The clock counts from process start: what ran before main's own code is the first reading.
  assert.equal(result.loadedAfterMs, 10);
  assert.deepEqual(result.channels["invoke:summary"], {
    count: 2,
    bytes: 20,
    maxMs: 20,
    buckets: [0, 1, 0, 1, 0, 0, 0],
  });
  for (let i = 0; i < 1000; i++) recorder.record(`channel-${i}`);
  assert.equal(Object.keys(recorder.snapshot().channels).length, 256);
});

test("IPC timing records successful and failed handlers", async () => {
  const { createIpcHandle } = await import("../../src/main/ipc-handle.ts");
  let now = 0;
  const recorder = new PerformanceRecorder(true, () => now);
  let call: ((event: { sender: null; senderFrame: null }, payload: unknown) => Promise<unknown>) | undefined;
  const handle = createIpcHandle(
    {
      handle: (_channel, listener) => {
        call = listener;
      },
    },
    { fixture: true, isStudioUi: () => true, performance: recorder },
  );
  handle("studio:cancel", () => {
    now += 4;
    throw new Error("failure");
  });
  assert.ok(call);
  await call({ sender: null, senderFrame: null }, { threadId: "t" });
  assert.equal(recorder.snapshot().channels["invoke:studio:cancel"]?.count, 1);
});

test("renderer journey histograms use renderer timestamp differences and retain receipt-clock startup", async () => {
  const { registerPerformanceIpc } = await import("../../src/main/ipc/performance.ts");
  const { PerformanceMarkName: Mark } = await import("../../src/shared/performance.ts");
  const { createIpcHandle } = await import("../../src/main/ipc-handle.ts");
  let now = 100;
  const recorder = new PerformanceRecorder(true, () => now);
  let call: ((event: { sender: null; senderFrame: null }, payload: unknown) => Promise<unknown>) | undefined;
  const handle = createIpcHandle(
    {
      handle: (_channel, listener) => {
        call = listener;
      },
    },
    { fixture: true, isStudioUi: () => true },
  );
  registerPerformanceIpc(handle, recorder);
  assert.ok(call);
  for (const [start, end] of [
    [Mark.EventBatch, Mark.GraphCommit],
    [Mark.Delta, Mark.TextPaint],
    [Mark.Keydown, Mark.ComposerCommit],
  ]) {
    now = 120;
    await call({ sender: null, senderFrame: null }, { name: start, at: 1000 });
    now = 900;
    await call({ sender: null, senderFrame: null }, { name: end, at: 1020 });
    const histogram = recorder.snapshot().channels[`journey:${start}->${end}`];
    assert.equal(histogram?.count, 1);
    assert.equal(histogram?.maxMs, 20);
    assert.deepEqual(histogram?.buckets, [0, 0, 0, 1, 0, 0, 0]);
    assert.equal(recorder.snapshot().marks[`renderer:${start}`], 20);
  }
});

test("pending renderer journeys are bounded, drain once and reject invalid or backwards samples", async () => {
  const { PerformanceMarkName: Mark } = await import("../../src/shared/performance.ts");
  const recorder = new PerformanceRecorder(true, () => 0);
  for (let at = 0; at < 1000; at++) recorder.rendererMark({ name: Mark.Delta, at });
  recorder.rendererMark({ name: Mark.TextPaint, at: 1100 });
  const key = `journey:${Mark.Delta}->${Mark.TextPaint}`;
  assert.equal(recorder.snapshot().channels[key]?.count, 64);
  assert.equal(recorder.snapshot().channels[key]?.maxMs, 164);
  recorder.rendererMark({ name: Mark.TextPaint, at: 1200 });
  assert.equal(recorder.snapshot().channels[key]?.count, 64);
  for (const at of [-1, Infinity, NaN]) recorder.rendererMark({ name: Mark.Delta, at });
  recorder.rendererMark({ name: Mark.TextPaint, at: 1500 });
  assert.equal(recorder.snapshot().channels[key]?.count, 64);
  recorder.rendererMark({ name: Mark.Keydown, at: 900 });
  recorder.rendererMark({ name: Mark.Keydown, at: 10 });
  recorder.rendererMark({ name: Mark.ComposerCommit, at: 5 });
  assert.equal(recorder.snapshot().channels[`journey:${Mark.Keydown}->${Mark.ComposerCommit}`], undefined);
  recorder.rendererMark({ name: Mark.ComposerCommit, at: 20 });
  assert.equal(recorder.snapshot().channels[`journey:${Mark.Keydown}->${Mark.ComposerCommit}`]?.maxMs, 10);
  assert.ok(JSON.stringify(recorder.snapshot()).length < 3000);
  const disabled = new PerformanceRecorder(false);
  disabled.rendererMark({ name: Mark.Delta, at: 1 });
  disabled.rendererMark({ name: Mark.TextPaint, at: 2 });
  assert.deepEqual(disabled.snapshot(), { enabled: false, marks: {}, channels: {} });
});
