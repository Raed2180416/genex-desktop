/**
 * The renderer follows every thread's log with one cursor. The cursor the core hands back must
 * never pass an event the renderer has not been given: an event appended to a thread that was
 * already read, while a later-read thread gains a newer one, used to be skipped for good
 * ("Building…" and Stop stuck, question cards never shown). `studio:events` and the bootstrap
 * serve this feed (`EventStore.listAllSince`); `listAllEvents` reads through it too.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventEnvelope } from "../../src/substrate/types.ts";
import { coreLite } from "../helpers/core-lite.ts";

const label = (event: EventEnvelope): string | undefined =>
  event.data.type === "custom" ? (event.data.payload as { label?: string } | undefined)?.label : undefined;
const mark = (value: string) => [{ type: "custom" as const, event_type: "cursor_probe", payload: { label: value } }];

describe("the all-threads event cursor", () => {
  it("delivers an event appended to an already-read thread while a later thread gains a newer one", async () => {
    const lite = await coreLite();
    const { core } = lite;
    const a = await core.store.createThread({ title: "a" });
    const b = await core.store.createThread({ title: "b" });
    await core.store.appendEvents(a, mark("a0"));
    await core.store.appendEvents(b, mark("b0"));

    const seen: string[] = [];
    let cursor: string | undefined;
    const pull = async () => {
      const page = await core.store.listAllSince(cursor);
      for (const event of page.events) {
        const l = label(event);
        if (l) seen.push(l);
      }
      cursor = page.cursor ?? undefined;
    };
    await pull();
    assert.deepEqual(seen, ["a0", "b0"]);

    // Interleave: thread `a` (which has news) is read, then — before `b` is read — `a` and
    // then `b` gain events.
    await core.store.appendEvents(a, mark("a0.5"));
    // The feed takes every thread's head first and reads the threads after it: the appends land
    // in between, once the heads are known and before any thread has been read.
    const headsSnapshot = core.store.headsSnapshot.bind(core.store);
    let raced = false;
    core.store.headsSnapshot = async () => {
      const heads = await headsSnapshot();
      if (!raced) {
        raced = true;
        await core.store.appendEvents(a, mark("a1-late"));
        await core.store.appendEvents(b, mark("b1-newer"));
      }
      return heads;
    };
    await pull();
    core.store.headsSnapshot = headsSnapshot;
    await pull();
    await pull();

    assert.ok(raced, "the interleaving ran");
    assert.ok(seen.includes("a1-late"), `a1-late never reaches the renderer: ${JSON.stringify(seen)}`);
    assert.ok(seen.includes("b1-newer"));
    assert.deepEqual([...seen].sort(), ["a0", "a0.5", "a1-late", "b0", "b1-newer"]);
    assert.equal(new Set(seen).size, seen.length, "no event is delivered twice");
    await lite.close();
  });

  it("returns a cursor with an empty page, and the bounded tail still carries the newest head", async () => {
    const lite = await coreLite();
    const { core } = lite;
    const thread = await core.store.createThread({ title: "tail" });
    for (let i = 0; i < 5; i++) await core.store.appendEvents(thread, mark(`t${i}`));
    const tail = await core.store.listAllSince(undefined, 3);
    assert.equal(tail.events.length, 3);
    const head = await core.store.head(thread);
    assert.ok(tail.cursor && tail.cursor >= head!, "the cursor covers every thread's head");
    const empty = await core.store.listAllSince(tail.cursor!);
    assert.deepEqual(empty.events, []);
    assert.equal(empty.cursor, tail.cursor, "an empty page keeps the cursor");
    await core.store.appendEvents(thread, mark("t5"));
    const next = await core.store.listAllSince(empty.cursor!);
    assert.deepEqual(next.events.map(label), ["t5"]);
    await lite.close();
  });
});
