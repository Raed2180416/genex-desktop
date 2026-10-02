import { test } from "node:test";
import assert from "node:assert/strict";
import { pollWhile } from "../../src/renderer/panels/run-stills.ts";

/** Lets the pending read promises settle between timer ticks. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a poll reads once when it may not repeat, and keeps nothing after it stops", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const stop = pollWhile(
    async () => {
      reads += 1;
    },
    false,
    1000,
  );
  await settle();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(reads, 1);
  stop();
});

test("an active poll reads again after each interval, and a stop ends it and marks later results stale", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const current: boolean[] = [];
  const pending: Array<() => void> = [];
  const stop = pollWhile(
    (isCurrent) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          current.push(isCurrent());
          resolve();
        });
      }),
    true,
    1000,
  );
  pending.shift()?.();
  await settle();
  t.mock.timers.tick(999);
  await settle();
  assert.deepEqual(current, [true]);
  assert.equal(pending.length, 0, "the next read waits the whole interval");
  t.mock.timers.tick(1);
  await settle();
  stop();
  pending.shift()?.();
  await settle();
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(current, [true, false], "a read that settles after the stop sees it is stale");
  assert.equal(pending.length, 0, "no read starts after the stop");
});

test("hidden still polls sleep and resume with one catch-up read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = new EventTarget();
  Object.assign(page, { hidden: true });
  const before = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  let reads = 0;
  const stop = pollWhile(
    async () => {
      reads++;
    },
    true,
    1000,
  );
  try {
    await settle();
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(reads, 0);
    Object.assign(page, { hidden: false });
    page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    assert.equal(reads, 1);
    page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    assert.equal(reads, 1, "a repeated visible event does not duplicate the catch-up");
  } finally {
    stop();
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
