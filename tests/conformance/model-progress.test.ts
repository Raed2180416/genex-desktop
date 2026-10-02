import assert from "node:assert/strict";
import test from "node:test";
import { modelProgress } from "../../src/main/model-progress.ts";
import type { ModelPullProgress } from "../../src/shared/ui-events.ts";

test("a burst emits its latest progress once and flush leaves no trailing update", () => {
  const sent: ModelPullProgress[] = [];
  let tick = () => {};
  let timers = 0;
  const progress = modelProgress(
    (value) => sent.push(value),
    (callback) => {
      timers++;
      tick = callback;
      return () => {};
    },
  );
  for (let i = 0; i < 100; i++) progress.update({ status: "pulling", completed: i });
  assert.equal(timers, 1);
  assert.equal(sent.length, 0);
  progress.flush();
  tick();
  assert.deepEqual(sent, [{ status: "pulling", completed: 99 }]);
});
