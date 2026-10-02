import assert from "node:assert/strict";
import { it } from "node:test";
import { elapsedOperations, timedOperation, type OperationSpan } from "../../src/harness-seed/loop/director/timing.ts";

it("measures actual completion and failure with monotonic time", async () => {
  const spans: OperationSpan[] = [];
  let now = 0;
  const clock = { wall: () => 100, monotonic: () => now };
  assert.equal(
    await timedOperation(
      "judge",
      "board",
      async () => {
        now = 7;
        return 42;
      },
      (span) => spans.push(span),
      clock,
    ),
    42,
  );
  await assert.rejects(
    timedOperation(
      "playtest",
      "board",
      async () => {
        now = 10;
        throw new Error("failed");
      },
      (span) => spans.push(span),
      clock,
    ),
    /failed/,
  );
  assert.deepEqual(
    spans.map((span) => [span.durationMs, span.settled]),
    [
      [7, true],
      [3, false],
    ],
  );
  assert.deepEqual(elapsedOperations(spans), { wallMs: 7, workMs: 10 });
});

it("host timings preserve cancellation and collect usage only from completed provider responses", async () => {
  const { tracedContext } = await import("../../src/harness-seed/loop/director/trace.ts");
  const { ctxRecorder } = await import("../helpers/ctx-recorder.ts");
  const { HostMethod } = await import("../../src/harness-seed/loop/host-methods.ts");
  const recorder = ctxRecorder({
    handlers: {
      [HostMethod.EngineComplete]: () => ({
        usage: { input_tokens: 12, output_tokens: 3, context: "not usage", cost_usd: Number.NaN },
      }),
    },
  });
  const spans: OperationSpan[] = [];
  const ctx = tracedContext(
    recorder.ctx,
    {
      runId: "timed",
      goal: "chess",
      reference: { name: "chess", shots: [] },
      project: "chess",
      engine: "codex",
      mode: "autopilot",
      budgets: { wallClockMs: 1000 },
    },
    (span) => spans.push(span),
  );
  await ctx.call(HostMethod.EngineComplete, { messages: [], model: "gpt-6-sol", effort: "high" });
  await ctx.call(HostMethod.EventsHead, { threadId: "thread" });
  recorder.cancel();
  assert.equal(ctx.cancelled, true, "the derived context must observe a live Stop");
  assert.equal(spans.length, 1, "polling is not another provider response");
  assert.deepEqual(spans[0]?.usage, { input_tokens: 12, output_tokens: 3 });
  assert.equal(spans[0]?.model, "gpt-6-sol");
  assert.equal(spans[0]?.effort, "high");
});

it("wall-time union ignores wall clock corrections within a monotonic clock domain", async () => {
  const spans: OperationSpan[] = [];
  let wall = 1000;
  let tick = 0;
  const clock = { wall: () => wall, monotonic: () => tick, origin: 1000 };
  await timedOperation(
    "first",
    null,
    async () => {
      tick = 10;
    },
    (span) => spans.push(span),
    clock,
  );
  wall = 1005;
  await timedOperation(
    "second",
    null,
    async () => {
      tick = 20;
    },
    (span) => spans.push(span),
    clock,
  );
  assert.deepEqual(elapsedOperations(spans), { wallMs: 20, workMs: 20 });
  assert.equal(spans[0]?.clockOrigin, 1000);
});
