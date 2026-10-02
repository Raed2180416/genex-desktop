/**
 * Atomicity / crash-resume drills: kill -9 during append leaves a loadable store, and chaos
 * drills run as fixtures.
 *
 * These are the tests that back hard constraint #4 (durable state): the studio is meant to run
 * unattended for hours, so "the machine died mid-append" has to be a non-event.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { EventStore } from "../../src/substrate/event-store.ts";
import { compareIds, uuidv7 } from "../../src/substrate/ids.ts";
import { TurnFactory } from "../../src/substrate/turns.ts";
import { tmpDir } from "../helpers/tmp.ts";

const CRASH_WRITER = fileURLToPath(new URL("../helpers/crash-writer.ts", import.meta.url));

/** Every event file parses, and the visible log stops at the head. */
async function assertStoreLoadable(store: EventStore, threadId: string): Promise<number> {
  const dir = store.eventsDir(threadId);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), "utf8");
    let parsed: { id?: string };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      assert.fail(`event file ${file} is not valid JSON (torn write): ${(err as Error).message}`);
    }
    assert.equal(parsed.id, file.slice(0, -5), `${file} must contain its own id`);
  }
  const events = await store.listEvents(threadId);
  const head = await store.head(threadId);
  assert.ok(head, "head must be set");
  assert.ok(
    events.some((e) => e.id === head),
    "head must name an event that exists on disk",
  );
  // The head is the visibility boundary: nothing beyond it may be readable.
  for (const event of events) assert.ok(compareIds(event.id, head!) <= 0);
  return events.length;
}

describe("atomicity under kill -9", () => {
  it("leaves a loadable, head-consistent store and resumes appending", async () => {
    const root = path.join(await tmpDir(), "exoharness");
    const store = await EventStore.open(root, "studio");
    const thread = await store.createThread({ title: "crash" });

    for (let attempt = 0; attempt < 3; attempt++) {
      const child = fork(CRASH_WRITER, [root, thread], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      await new Promise<void>((resolve) => {
        child.on("message", (msg: { appending?: boolean }) => {
          if (msg.appending) resolve();
        });
      });
      // Land the kill in the middle of the write storm.
      await new Promise((r) => setTimeout(r, 40 + attempt * 25));
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.on("exit", () => resolve()));

      const reopened = await EventStore.open(root, "studio");
      const count = await assertStoreLoadable(reopened, thread);
      assert.ok(count > 1, "the crashed writer should have committed at least one event");

      // The store keeps working after the crash — no repair step, no lock file to clear.
      const resumed = await reopened.appendEvents(thread, [{ type: "error", message: `resumed ${attempt}` }]);
      assert.equal(await reopened.head(thread), resumed.latestEventId);
    }
  });

  it("quarantines the uncommitted tail instead of resurrecting it on the next append", async () => {
    const root = path.join(await tmpDir(), "exoharness");
    const store = await EventStore.open(root, "studio");
    const thread = await store.createThread();
    const committed = await store.appendEvents(thread, [{ type: "error", message: "committed" }]);

    // Simulate a crash after two event files were written but before the head advanced: the
    // files exist, the record still points at the earlier head.
    const orphanIds: string[] = [];
    for (const message of ["half-written batch 1", "half-written batch 2"]) {
      const id = uuidv7();
      orphanIds.push(id);
      await writeFile(
        store.eventPath(thread, id),
        JSON.stringify({
          id,
          thread_id: thread,
          session_id: null,
          turn_id: null,
          created_at: new Date().toISOString(),
          data: { type: "error", message },
        }),
      );
    }

    // Reads stop at the head — the uncommitted tail was never observable.
    const reopened = await EventStore.open(root, "studio");
    let visible = await reopened.listEvents(thread);
    assert.equal(visible.at(-1)!.id, committed.latestEventId);
    assert.ok(!visible.some((e) => orphanIds.includes(e.id)));

    // ...and the next append quarantines it, so moving the head past those ids cannot
    // resurrect a partially written batch.
    const next = await reopened.appendEvents(thread, [{ type: "error", message: "after recovery" }]);
    visible = await reopened.listEvents(thread);
    assert.ok(!visible.some((e) => orphanIds.includes(e.id)), "uncommitted events stay invisible");
    assert.equal(visible.at(-1)!.id, next.latestEventId);
    assert.deepEqual((await reopened.uncommittedEvents(thread)).sort(), [...orphanIds].sort());
  });

  it("ignores leftover temp files from an interrupted write", async () => {
    const root = path.join(await tmpDir(), "exoharness");
    const store = await EventStore.open(root, "studio");
    const thread = await store.createThread();
    const { events } = await store.appendEvents(thread, [{ type: "error", message: "real" }]);

    // Simulate a process killed between "open temp file" and "rename".
    await writeFile(path.join(store.eventsDir(thread), ".tmp-999-abcdef"), '{"id": "hal');

    const listed = await store.listEvents(thread);
    assert.equal(listed.at(-1)!.id, events[0]!.id);
    assert.equal(await store.head(thread), events[0]!.id);
  });
});

describe("crash-resume semantics", () => {
  it("recovers the interrupted turn's input from the log after a hard kill", async () => {
    const root = path.join(await tmpDir(), "exoharness");
    const store = await EventStore.open(root, "studio");
    const thread = await store.createThread();

    // Session 1: the turn's input is made durable, then the process "dies" before answering.
    const turns = new TurnFactory(store, "ses_1");
    const turn = await turns.beginTurn(thread, { input: [{ role: "user", content: "build an asteroids clone" }] });
    assert.ok(turn.turnId);

    // Session 2: a fresh process reopens the same directory.
    const reopened = await EventStore.open(root, "studio");
    const messages = await reopened.listMessages(thread);
    assert.deepEqual(messages, [{ role: "user", content: "build an asteroids clone" }]);

    const events = await reopened.listEvents(thread);
    const started = events.filter((e) => e.data.type === "turn_started");
    const ended = events.filter((e) => e.data.type === "turn_ended");
    assert.equal(started.length, 1);
    assert.equal(ended.length, 0, "the interrupted turn is visibly unfinished in the log");
  });
});
