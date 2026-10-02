/**
 * The event store keeps an in-memory, sorted id list per conversation (derived and disposable;
 * the files stay the truth). Cursor, tail and page reads answer from it and read only the bodies
 * they return, so a poll or a page costs what it returns, not the size of the history.
 *
 * Reading a folder's listing needs the folder's read bit; opening a file inside it by name needs
 * only the execute bit. So a folder made unlistable proves a read did not list it, and an
 * unreadable body proves a read did not open it.
 */
import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { EventStore } from "../../src/substrate/event-store.ts";
import type { EventEnvelope } from "../../src/substrate/types.ts";
import { closeBeforeCleanup, tmpDir } from "../helpers/tmp.ts";

const note = (label: string) => ({ type: "custom" as const, event_type: "probe", payload: { label } });
const labels = (events: EventEnvelope[]) =>
  events.map((e) => (e.data.type === "custom" ? (e.data.payload as { label: string }).label : e.data.type));

async function makeUnlistable(dir: string): Promise<void> {
  // The folder gets its read bit back before the temp cleanup removes it.
  closeBeforeCleanup(() => chmod(dir, 0o700));
  await chmod(dir, 0o300);
}

async function openStore(): Promise<EventStore> {
  return EventStore.open(path.join(await tmpDir("studio-event-index-"), "exoharness"), "studio");
}

describe("event store: reads that answer from the id index", () => {
  it("cursor, tail and page reads never list a conversation's folder once it is known", async () => {
    const store = await openStore();
    const thread = await store.createThread({ title: "busy" });
    const first = await store.appendEvents(thread, ["a", "b", "c"].map(note));
    assert.equal((await store.listEvents(thread)).length, 4);

    await makeUnlistable(store.eventsDir(thread));
    // Appends keep working: they write files by name, and extend the index as they go.
    const later = await store.appendEvents(thread, ["d", "e"].map(note));

    assert.deepEqual(labels(await store.listEvents(thread, { after: first.latestEventId })), ["d", "e"]);
    assert.deepEqual(labels(await store.listEvents(thread, { tail: true, limit: 3 })), ["c", "d", "e"]);
    assert.deepEqual(labels(await store.listEvents(thread, { upToInclusive: first.events[1]!.id })), [
      "thread_created",
      "a",
      "b",
    ]);
    assert.deepEqual(await store.listEvents(thread, { after: later.latestEventId }), []);
    const page = await store.chatPage(thread);
    assert.deepEqual(labels(page.events), ["thread_created", "a", "b", "c", "d", "e"]);
    const feed = await store.listAllSince(first.latestEventId);
    assert.deepEqual(labels(feed.events), ["d", "e"]);
    assert.equal(feed.cursor, later.latestEventId);
  });

  it("a bounded feed opens only the bodies it returns", async () => {
    const store = await openStore();
    const old = await store.createThread({ title: "old" });
    const oldEvents = await store.appendEvents(old, ["old-1", "old-2", "old-3"].map(note));
    const recent = await store.createThread({ title: "recent" });
    await store.appendEvents(recent, ["new-1", "new-2", "new-3"].map(note));

    // An old body nobody asked for is unreadable: a feed of the newest three must not open it.
    await writeFile(store.eventPath(old, oldEvents.events[0]!.id), "{ not json");
    const reopened = await EventStore.open(store.root, "studio");
    const feed = await reopened.listAllSince(undefined, 3);
    assert.deepEqual(labels(feed.events), ["new-1", "new-2", "new-3"]);
  });

  it("an index older than the head on disk is rebuilt, so another writer's events are not missed", async () => {
    const store = await openStore();
    const thread = await store.createThread();
    await store.appendEvents(thread, [note("mine")]);
    assert.equal((await store.listEvents(thread)).length, 2);

    // Another handle on the same folder (a second process in a test drill) appends behind our back.
    const other = await EventStore.open(store.root, "studio");
    await other.appendEvents(thread, [note("theirs")]);

    assert.deepEqual(labels(await store.listEvents(thread)), ["thread_created", "mine", "theirs"]);
  });

  it("a quarantined uncommitted tail leaves the index, and later appends read back in order", async () => {
    const store = await openStore();
    const thread = await store.createThread();
    const committed = await store.appendEvents(thread, [note("committed")]);
    const reopened = await EventStore.open(store.root, "studio");
    // A torn batch: a file after the head the record never reached.
    const orphan = { ...committed.events[0]!, id: "ffffffff-ffff-7fff-bfff-ffffffffffff", data: note("torn") };
    await writeFile(reopened.eventPath(thread, orphan.id), JSON.stringify(orphan));
    assert.deepEqual(labels(await reopened.listEvents(thread)), ["thread_created", "committed"]);

    await reopened.appendEvents(thread, [note("after")]);
    assert.deepEqual(labels(await reopened.listEvents(thread)), ["thread_created", "committed", "after"]);
    assert.deepEqual(await reopened.uncommittedEvents(thread), [orphan.id]);
  });
});
