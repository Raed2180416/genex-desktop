import test from "node:test";
import assert from "node:assert/strict";
import { HarnessLogBatch, type HarnessLogMessage } from "../../src/main/harness-log-batch.ts";

test("renderer log bursts coalesce and preserve mixed stream order on flush", () => {
  const messages: HarnessLogMessage[] = [];
  const batch = new HarnessLogBatch((message) => messages.push(message));
  for (let i = 0; i < 100; i++) batch.push(String(i), "stderr");
  assert.equal(messages.length, 0);
  batch.push("out", "stdout");
  batch.push("last", "stderr");
  batch.flush();
  assert.deepEqual(messages, [
    { line: Array.from({ length: 100 }, (_, i) => String(i)).join("\n"), stream: "stderr" },
    { line: "out", stream: "stdout" },
    { line: "last", stream: "stderr" },
  ]);
});

test("log cadence flushes once, bounds pending data and leaves no callback after explicit flush", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const messages: HarnessLogMessage[] = [];
  const batch = new HarnessLogBatch((message) => messages.push(message));
  batch.push("one", "stderr");
  t.mock.timers.tick(49);
  assert.equal(messages.length, 0);
  t.mock.timers.tick(1);
  assert.equal(messages.length, 1);
  batch.push("x".repeat(40_000), "stdout");
  batch.push("y".repeat(40_000), "stdout");
  assert.equal(messages.length, 2);
  batch.flush();
  assert.equal(messages.length, 3);
  t.mock.timers.tick(1000);
  assert.equal(messages.length, 3);
  assert.equal(messages[1]?.line.length, 40_000);
  assert.equal(messages[2]?.line.length, 40_000);
});
