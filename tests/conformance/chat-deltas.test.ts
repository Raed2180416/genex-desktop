import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDeltas } from "../../src/main/core/chat-deltas.ts";
import type { ChatDelta } from "../../src/shared/ui-events.ts";

test("token batches preserve replacements and flush before terminal events", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const emitted: ChatDelta[] = [];
  const stream = chatDeltas((delta) => emitted.push(delta));
  stream.push({ threadId: "t", streamId: "s", delta: "old" });
  stream.push({ threadId: "t", streamId: "s", delta: "new", replace: true });
  stream.push({ threadId: "t", streamId: "s", delta: " text" });
  assert.equal(emitted.length, 0);
  t.mock.timers.tick(33);
  assert.deepEqual(emitted, [{ threadId: "t", streamId: "s", delta: "new text", replace: true }]);
  stream.push({ threadId: "t", streamId: "s", delta: " end" });
  stream.flush();
  assert.equal(emitted.at(-1)?.delta, " end");
  t.mock.timers.tick(100);
  assert.equal(emitted.length, 2);
});
