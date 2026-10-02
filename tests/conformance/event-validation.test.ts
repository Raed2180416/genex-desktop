/**
 * The event log is written by an agent-editable harness over RPC. One entry that is not an event
 * (`batch: [maybeEvent]` with `maybeEvent` undefined arrives as `null`) used to be persisted and
 * then broke every projection of that thread for good, because rollback never touches the log.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { chatContext } from "../../src/shared/chat-history.ts";
import { EventStore } from "../../src/substrate/event-store.ts";
import { uuid7Timestamp, uuidv7 } from "../../src/substrate/ids.ts";
import type { ConversationRecord, EventData } from "../../src/substrate/types.ts";
import { tmpDir } from "../helpers/tmp.ts";

const ok: EventData = { type: "custom", event_type: "probe", payload: { n: 1 } };

describe("event log integrity", () => {
  it("refuses a batch holding anything that is not an event, and writes none of it", async () => {
    const store = await EventStore.open(path.join(await tmpDir("studio-event-shape-"), "exoharness"));
    const thread = await store.createThread({ title: "shape" });
    const head = await store.head(thread);
    const bad: unknown[] = [null, undefined, 42, "messages", [], {}, { type: 7 }, [ok]];
    for (const entry of bad) {
      await assert.rejects(
        store.appendEvents(thread, [ok, entry] as EventData[]),
        /not an event/,
        JSON.stringify(entry) ?? "undefined",
      );
    }
    assert.equal(await store.head(thread), head, "the head did not move");
    assert.deepEqual(
      (await store.listEvents(thread)).map((e) => e.data.type),
      ["thread_created"],
    );
    await store.appendEvents(thread, [ok]);
    assert.equal((await store.listEvents(thread)).length, 2, "the thread still takes good events");
  });

  it("reads past an event already persisted without a body", async () => {
    const store = await EventStore.open(path.join(await tmpDir("studio-event-poisoned-"), "exoharness"));
    const thread = await store.createThread({ title: "poisoned" });
    const id = uuidv7();
    await writeFile(
      store.eventPath(thread, id),
      JSON.stringify({
        id,
        thread_id: thread,
        session_id: null,
        turn_id: null,
        created_at: uuid7Timestamp(id),
        data: null,
      }),
    );
    const record = JSON.parse(await readFile(store.recordPath(thread), "utf8")) as ConversationRecord;
    await writeFile(store.recordPath(thread), JSON.stringify({ ...record, latest_event_id: id }));
    await store.appendEvents(thread, [ok]);

    const events = await store.listEvents(thread);
    assert.deepEqual(
      events.map((e) => e.data.type),
      ["thread_created", "error", "custom"],
    );
    assert.doesNotThrow(() => chatContext([], events));
    const page = await store.chatPage(thread);
    assert.deepEqual(
      page.events.map((e) => e.data.type),
      ["thread_created", "error", "custom"],
    );
    assert.equal((await store.getEvent(thread, id))?.data.type, "error");
  });
});
