/** The per-key queue the core's previews, shows and covers run through (`src/main/core/serial.ts`). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { serial } from "../../src/main/core/serial.ts";

const later =
  <T>(value: T, log: string[], name: string) =>
  async () => {
    log.push(`${name} start`);
    await new Promise((resolve) => setImmediate(resolve));
    log.push(`${name} end`);
    return value;
  };

test("work under one key runs one at a time, in order; other keys do not wait", async () => {
  const queue = new Map<string, Promise<unknown>>();
  const log: string[] = [];
  const results = await Promise.all([
    serial(queue, "live", later(1, log, "a")),
    serial(queue, "live", later(2, log, "b")),
    serial(queue, "other", later(3, log, "c")),
  ]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.ok(log.indexOf("a end") < log.indexOf("b start"), log.join(", "));
  assert.ok(log.indexOf("c start") < log.indexOf("b start"), "another key starts at once");
  assert.equal(queue.size, 0, "a settled key leaves the queue");
});

test("a failure is its own caller's, and does not stop the next one", async () => {
  const queue = new Map<string, Promise<unknown>>();
  const failed = serial(queue, "k", async () => {
    throw new Error("boom");
  });
  const next = serial(queue, "k", async () => "ran");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ran");
  assert.equal(queue.size, 0);
});
