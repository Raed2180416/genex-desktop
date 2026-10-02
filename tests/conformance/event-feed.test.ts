/**
 * The renderer's log refresh: nothing reads the log before the bootstrap has set the cursor
 * (an early poll or notification read every thread's whole log, uncapped), and a read is merged
 * into the window without duplicates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendFeed, eventRefreshAction, FEED_WINDOW } from "../../src/renderer/event-feed.ts";
import type { EventEnvelope } from "../../src/substrate/types.ts";

const event = (n: number): EventEnvelope => ({
  id: String(n).padStart(8, "0"),
  thread_id: "t",
  session_id: null,
  turn_id: null,
  created_at: new Date(n).toISOString(),
  data: { type: "error", message: String(n) },
});

describe("renderer event feed", () => {
  it("never reads the log before the bootstrap has set the cursor", () => {
    assert.equal(eventRefreshAction({ bootstrapped: false, inFlight: false }), "defer");
    assert.equal(eventRefreshAction({ bootstrapped: false, inFlight: true }), "defer");
    assert.equal(eventRefreshAction({ bootstrapped: true, inFlight: true }), "queue");
    assert.equal(eventRefreshAction({ bootstrapped: true, inFlight: false }), "fetch");
  });

  it("merges a read without duplicates and keeps the newest window", () => {
    const current = [event(1), event(2)];
    assert.equal(appendFeed(current, []), current, "an empty read keeps the same array");
    assert.equal(appendFeed(current, [event(2)]), current, "a read of held events keeps the same array");
    assert.deepEqual(
      appendFeed(current, [event(2), event(3)]).map((e) => e.id),
      [event(1), event(2), event(3)].map((e) => e.id),
    );
    const full = Array.from({ length: FEED_WINDOW }, (_, i) => event(i));
    const next = appendFeed(full, [event(FEED_WINDOW)]);
    assert.equal(next.length, FEED_WINDOW);
    assert.equal(next.at(-1)!.id, event(FEED_WINDOW).id);
  });
});
