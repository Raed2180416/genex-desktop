/**
 * The one poll the smoke, self test and acceptance runners share (`src/main/smoke/wait.ts`).
 * The runners themselves need Electron; the helper they wait with does not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitFor } from "../../src/main/smoke/wait.ts";

test("waitFor answers true as soon as the probe does, without sleeping first", async () => {
  let asked = 0;
  const started = Date.now();
  assert.equal(
    await waitFor(
      () => {
        asked++;
        return "yes";
      },
      { timeoutMs: 5_000, intervalMs: 1_000 },
    ),
    true,
  );
  assert.equal(asked, 1);
  assert.ok(Date.now() - started < 500, "a probe that is already true is not followed by an interval");
});

test("waitFor keeps asking at the interval and awaits an async probe", async () => {
  let asked = 0;
  assert.equal(await waitFor(async () => ++asked === 3, { timeoutMs: 5_000, intervalMs: 5 }), true);
  assert.equal(asked, 3);
});

test("waitFor answers false once the deadline passes, and treats falsy answers alike", async () => {
  const answers = [0, "", null, undefined, false];
  let asked = 0;
  assert.equal(await waitFor(() => answers[asked++ % answers.length], { timeoutMs: 40, intervalMs: 5 }), false);
  assert.ok(asked >= 2, `asked ${asked} times`);
});

test("waitFor rejects with the probe's error: tolerating a failing probe is the caller's choice", async () => {
  await assert.rejects(
    waitFor(
      () => {
        throw new Error("probe broke");
      },
      { timeoutMs: 100, intervalMs: 5 },
    ),
    /probe broke/,
  );
  assert.equal(
    await waitFor(() => Promise.reject(new Error("x")).catch(() => false), { timeoutMs: 20, intervalMs: 5 }),
    false,
  );
});
