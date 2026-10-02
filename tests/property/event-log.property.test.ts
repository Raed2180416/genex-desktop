/**
 * Property tests.
 *
 * The conformance suite pins the behaviours we ported on purpose; these check the invariants
 * hold for *arbitrary* histories, which is where a hand-written port usually breaks.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import fc from "fast-check";
import { EventStore } from "../../src/substrate/event-store.ts";
import { compareIds } from "../../src/substrate/ids.ts";
import type { EventData } from "../../src/substrate/types.ts";
import { tmpDir } from "../helpers/tmp.ts";

// One fixed seed for every property, so two runs of this file try the same histories. FC_SEED
// replays a reported failure or explores another corner; a failure names the seed it ran with.
const SEED = process.env.FC_SEED === undefined ? 20260923 : Number.parseInt(process.env.FC_SEED, 10);
if (!Number.isSafeInteger(SEED)) throw new Error(`FC_SEED must be an integer, got ${process.env.FC_SEED}`);
fc.configureGlobal({ seed: SEED });

async function check<Ts>(property: fc.IAsyncProperty<Ts>, params?: fc.Parameters<Ts>): Promise<void> {
  try {
    await fc.assert(property, params);
  } catch (error) {
    throw new Error(`fast-check failed with seed ${SEED} (rerun with FC_SEED=${SEED})\n${(error as Error).message}`, {
      cause: error,
    });
  }
}

const arbEvent: fc.Arbitrary<EventData> = fc.oneof(
  fc.record({
    type: fc.constant("messages" as const),
    messages: fc.array(
      fc.record({
        role: fc.constantFrom("user" as const, "assistant" as const, "system" as const),
        content: fc.string({ maxLength: 200 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  }),
  fc.record({ type: fc.constant("error" as const), message: fc.string({ maxLength: 80 }) }),
  fc.record({
    type: fc.constant("custom" as const),
    event_type: fc.constantFrom("probe", "run.note", "delegated.claude_code"),
    payload: fc.jsonValue({ maxDepth: 2 }),
  }),
  fc.record({
    type: fc.constant("tool_requested" as const),
    tool_call_id: fc.uuid(),
    request: fc.record({
      name: fc.constantFrom("write_file", "run", "screenshot"),
      arguments: fc.jsonValue({ maxDepth: 1 }),
    }),
  }),
);

const arbBatches = fc.array(fc.array(arbEvent, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 12 });

describe("property: append-only log", () => {
  it("keeps the head monotonic and never rewrites history", async () => {
    await check(
      fc.asyncProperty(arbBatches, async (batches) => {
        const store = await EventStore.open(path.join(await tmpDir("studio-prop-"), "exoharness"), "studio");
        const thread = await store.createThread();

        const snapshotsOfLog: string[][] = [];
        const contents = new Map<string, string>();
        let previousHead = await store.head(thread);

        for (const batch of batches) {
          const result = await store.appendEvents(thread, batch);
          // Head strictly advances.
          assert.ok(compareIds(result.latestEventId, previousHead!) > 0);
          previousHead = result.latestEventId;

          const events = await store.listEvents(thread);
          // Ordering is total and matches mint order.
          for (let i = 1; i < events.length; i++) {
            assert.ok(compareIds(events[i]!.id, events[i - 1]!.id) > 0);
          }
          // Everything seen before is byte-identical now (append-only, never mutated).
          for (const event of events) {
            const raw = await readFile(store.eventPath(thread, event.id), "utf8");
            const known = contents.get(event.id);
            if (known !== undefined) assert.equal(raw, known, "an existing event file was rewritten");
            else contents.set(event.id, raw);
          }
          // Each prior view is a prefix of the current one.
          const ids = events.map((e) => e.id);
          for (const earlier of snapshotsOfLog) {
            assert.deepEqual(ids.slice(0, earlier.length), earlier, "log is not append-only");
          }
          snapshotsOfLog.push(ids);
        }

        // Replay determinism: a fresh handle on the same directory sees the same log.
        const reopened = await EventStore.open(store.root, "studio");
        assert.deepEqual(
          (await reopened.listEvents(thread)).map((e) => e.id),
          snapshotsOfLog.at(-1),
        );
      }),
      { numRuns: 25 },
    );
  });

  it("forks reproduce exactly the prefix, for any cut point", async () => {
    await check(
      fc.asyncProperty(arbBatches, fc.double({ min: 0, max: 1, noNaN: true }), async (batches, cutRatio) => {
        const store = await EventStore.open(path.join(await tmpDir("studio-prop-"), "exoharness"), "studio");
        const thread = await store.createThread();
        for (const batch of batches) await store.appendEvents(thread, batch);

        const events = await store.listEvents(thread);
        const cutIndex = Math.min(events.length - 1, Math.floor(cutRatio * events.length));
        const cut = events[cutIndex]!.id;

        const fork = await store.forkThread(thread, cut);
        const forked = await store.listEvents(fork);

        assert.equal(forked.length, cutIndex + 2, "prefix + thread_forked");
        assert.deepEqual(
          forked.slice(0, -1).map((e) => JSON.stringify(e.data)),
          events.slice(0, cutIndex + 1).map((e) => JSON.stringify(e.data)),
          "forked payloads must equal the source prefix",
        );
        // Source untouched.
        assert.equal((await store.listEvents(thread)).length, events.length);
      }),
      { numRuns: 15 },
    );
  });

  it("answers every cursor, bound, tail and feed read from memory exactly as from the folder", async () => {
    const arbRead = fc.record({
      thread: fc.nat({ max: 2 }),
      after: fc.option(fc.nat(), { nil: undefined }),
      upTo: fc.option(fc.nat(), { nil: undefined }),
      limit: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
      tail: fc.boolean(),
    });
    const arbStep = fc.oneof(
      fc.record({
        kind: fc.constant("append" as const),
        thread: fc.nat({ max: 2 }),
        batch: fc.array(arbEvent, { minLength: 1, maxLength: 3 }),
      }),
      fc.record({ kind: fc.constant("fork" as const), thread: fc.nat({ max: 2 }), at: fc.nat() }),
      fc.record({ kind: fc.constant("read" as const), read: arbRead }),
    );
    await check(
      fc.asyncProperty(fc.array(arbStep, { minLength: 1, maxLength: 20 }), async (steps) => {
        const store = await EventStore.open(path.join(await tmpDir("studio-prop-"), "exoharness"), "studio");
        const threads = [await store.createThread(), await store.createThread(), await store.createThread()];
        // Every id each thread holds, as the folder has it: the model the reads are checked against.
        const known = new Map<string, string[]>();
        for (const thread of threads)
          known.set(
            thread,
            (await store.listEvents(thread)).map((e) => e.id),
          );
        const pick = (thread: string, n: number | undefined) => {
          const ids = known.get(thread)!;
          return n === undefined || ids.length === 0 ? undefined : ids[n % ids.length];
        };
        for (const step of steps) {
          if (step.kind === "append") {
            const thread = threads[step.thread]!;
            const { events } = await store.appendEvents(thread, step.batch);
            known.get(thread)!.push(...events.map((e) => e.id));
          } else if (step.kind === "fork") {
            const source = threads[step.thread]!;
            const cut = pick(source, step.at)!;
            const fork = await store.forkThread(source, cut);
            threads.push(fork);
            known.set(
              fork,
              (await EventStore.open(store.root, "studio").then((cold) => cold.listEvents(fork))).map((e) => e.id),
            );
          } else {
            const thread = threads[step.read.thread % threads.length]!;
            const after = pick(thread, step.read.after);
            const upToInclusive = pick(thread, step.read.upTo);
            const options = {
              ...(after ? { after } : {}),
              ...(upToInclusive ? { upToInclusive } : {}),
              ...(step.read.limit ? { limit: step.read.limit } : {}),
              tail: step.read.tail,
            };
            const cold = await EventStore.open(store.root, "studio");
            const warm = (await store.listEvents(thread, options)).map((e) => e.id);
            assert.deepEqual(
              warm,
              (await cold.listEvents(thread, options)).map((e) => e.id),
            );
            let expected = known
              .get(thread)!
              .filter(
                (id) => (!after || compareIds(id, after) > 0) && (!upToInclusive || compareIds(id, upToInclusive) <= 0),
              );
            if (step.read.limit)
              expected = step.read.tail ? expected.slice(-step.read.limit) : expected.slice(0, step.read.limit);
            assert.deepEqual(warm, expected);
            const feed = await store.listAllSince(after, step.read.limit);
            assert.deepEqual(feed, await cold.listAllSince(after, step.read.limit));
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it("delivers watchers exactly the events the log contains", async () => {
    await check(
      fc.asyncProperty(arbBatches, async (batches) => {
        const store = await EventStore.open(path.join(await tmpDir("studio-prop-"), "exoharness"), "studio");
        const thread = await store.createThread();
        const seen: string[] = [];
        const subscription = store.watch(thread, (e) => seen.push(e.id), { replay: true });
        const writes = batches.map((batch) => store.appendEvents(thread, batch));
        await Promise.all([subscription.ready, ...writes]);
        const logged = (await store.listEvents(thread)).map((e) => e.id);
        assert.deepEqual(seen, logged);
        subscription.close();
      }),
      { numRuns: 15 },
    );
  });
});
