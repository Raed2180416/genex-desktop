/**
 * Event ids are UUIDv7 and the head is the visibility boundary, so an id that sorts before the
 * stored history hides that history. The in-memory monotonic floor starts empty on every launch;
 * the stored log must carry it over, or a wall clock set back across a restart makes a thread's
 * earlier history vanish, and the next launch moves it into `.uncommitted`.
 *
 * A fresh generator plus an injected clock stands in for "another process, another time".
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { EventStore } from "../../src/substrate/event-store.ts";
import { compareIds, createUuidv7Generator, uuid7Timestamp } from "../../src/substrate/ids.ts";
import type { ConversationRecord, EventEnvelope } from "../../src/substrate/types.ts";
import { tmpDir } from "../helpers/tmp.ts";

const T = Date.parse("2026-09-23T12:00:00.000Z");
const HOUR = 3_600_000;
const launch = (root: string, now: number, warnings: string[] = []) =>
  EventStore.open(root, "studio", { now: () => now, ids: createUuidv7Generator(), warn: (m) => warnings.push(m) });
const mark = (label: string) => [{ type: "custom" as const, event_type: "clock_probe", payload: { label } }];
const labels = (events: EventEnvelope[]) =>
  events.map((e) => (e.data.type === "custom" ? (e.data.payload as { label: string }).label : e.data.type));

describe("event ids across restarts", () => {
  it("a fresh generator resumes after a stored id, even with the clock behind it", () => {
    const earlier = createUuidv7Generator();
    const stored = [earlier(T + 5), earlier(T + 5), earlier(T + 5)].at(-1)!;
    const next = createUuidv7Generator()(T - HOUR, stored);
    assert.ok(compareIds(next, stored) > 0, `${next} must sort after ${stored}`);
  });

  it("a restart with the clock set back keeps the thread's history visible and in order", async () => {
    const root = path.join(await tmpDir("studio-clock-"), "exoharness");
    const first = await launch(root, T);
    const thread = await first.createThread({ title: "clock" });
    await first.appendEvents(thread, mark("run1-a"));
    await first.appendEvents(thread, mark("run1-b"));

    const back = await launch(root, T - HOUR);
    await back.appendEvents(thread, mark("run2-clock-back-1h"));
    assert.deepEqual(labels(await back.listEvents(thread)), [
      "thread_created",
      "run1-a",
      "run1-b",
      "run2-clock-back-1h",
    ]);

    const fixed = await launch(root, T + 1_000);
    await fixed.appendEvents(thread, mark("run3-clock-fixed"));
    assert.deepEqual(labels(await fixed.listEvents(thread)), [
      "thread_created",
      "run1-a",
      "run1-b",
      "run2-clock-back-1h",
      "run3-clock-fixed",
    ]);
    assert.deepEqual(await fixed.uncommittedEvents(thread), [], "nothing was quarantined");
  });

  it("a fork made with the clock set back sorts after its source", async () => {
    const root = path.join(await tmpDir("studio-clock-fork-"), "exoharness");
    const first = await launch(root, T);
    const source = await first.createThread({ title: "source" });
    await first.appendEvents(source, mark("before-fork"));
    const head = (await first.head(source))!;
    const back = await launch(root, T - HOUR);
    const fork = await back.forkThread(source, head);
    for (const event of await back.listEvents(fork))
      assert.ok(compareIds(event.id, head) > 0, "fork ids sort after the source history");
  });

  it("recovery refuses to quarantine committed history behind a regressed head, loudly", async () => {
    const root = path.join(await tmpDir("studio-clock-damaged-"), "exoharness");
    const first = await launch(root, T);
    const thread = await first.createThread({ title: "damaged" });
    await first.appendEvents(thread, mark("history-a"));
    await first.appendEvents(thread, mark("history-b"));
    // A log written before the fix: a launch with the clock an hour behind committed a head that
    // sorts before everything already there.
    const regressed = createUuidv7Generator()(T - HOUR);
    await writeFile(
      first.eventPath(thread, regressed),
      JSON.stringify({
        id: regressed,
        thread_id: thread,
        session_id: null,
        turn_id: null,
        created_at: uuid7Timestamp(regressed),
        data: mark("regressed-head")[0],
      }),
    );
    const record = JSON.parse(await readFile(first.recordPath(thread), "utf8")) as ConversationRecord;
    await writeFile(first.recordPath(thread), JSON.stringify({ ...record, latest_event_id: regressed }));

    const warnings: string[] = [];
    const next = await launch(root, T + 1_000, warnings);
    await next.appendEvents(thread, mark("next-launch"));
    assert.deepEqual(await next.uncommittedEvents(thread), [], "committed history is never quarantined");
    assert.deepEqual(labels(await next.listEvents(thread)), [
      "regressed-head",
      "thread_created",
      "history-a",
      "history-b",
      "next-launch",
    ]);
    assert.equal(warnings.length, 1, "the refusal is reported");
    assert.match(warnings[0]!, /3 events/);
  });

  it("a crash mid-batch still quarantines the uncommitted tail", async () => {
    const root = path.join(await tmpDir("studio-clock-crash-"), "exoharness");
    const first = await launch(root, T);
    const thread = await first.createThread({ title: "crash" });
    const ids = createUuidv7Generator();
    const orphan = ids(T + 10, await first.head(thread));
    await writeFile(
      first.eventPath(thread, orphan),
      JSON.stringify({
        id: orphan,
        thread_id: thread,
        session_id: null,
        turn_id: null,
        created_at: uuid7Timestamp(orphan),
        data: mark("torn")[0],
      }),
    );
    const warnings: string[] = [];
    const next = await launch(root, T + 20, warnings);
    await next.appendEvents(thread, mark("after-crash"));
    assert.deepEqual(await next.uncommittedEvents(thread), [orphan]);
    assert.deepEqual(labels(await next.listEvents(thread)), ["thread_created", "after-crash"]);
    assert.deepEqual(warnings, []);
  });
});
