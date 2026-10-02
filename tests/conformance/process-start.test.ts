import assert from "node:assert/strict";
import { it } from "node:test";
import { startWithRecovery, type PendingProcess } from "../../src/substrate/process-start.ts";

function refused(error: unknown, pid?: number): PendingProcess<string> {
  return Object.assign(Promise.reject(error), { child: { pid } });
}
const admissionError = () => Object.assign(new Error("spawn git EAGAIN"), { code: "EAGAIN", syscall: "spawn git" });

it("retries only refused starts, preserving the first successfully executed result", async () => {
  let starts = 0;
  const waits: number[] = [];
  const result = await startWithRecovery(
    () =>
      ++starts < 3
        ? refused(admissionError())
        : Object.assign(Promise.resolve("committed once"), { child: { pid: 42 } }),
    {
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.equal(result, "committed once");
  assert.equal(starts, 3);
  assert.deepEqual(waits, [100, 250]);
});

it("stops after three OS admission refusals and preserves the last diagnostic", async () => {
  let starts = 0;
  const errors = [admissionError(), admissionError(), admissionError()];
  await assert.rejects(
    startWithRecovery(() => refused(errors[starts++]!), { wait: async () => {} }),
    (e) => e === errors[2],
  );
  assert.equal(starts, 3);
});

it("never replays a started command, signal, exit failure or non-admission error", async () => {
  for (const [error, pid] of [
    [admissionError(), 42],
    [Object.assign(new Error("git failed"), { code: 128 }), 42],
    [Object.assign(new Error("killed"), { signal: "SIGTERM" }), 42],
    [Object.assign(new Error("missing git"), { code: "ENOENT", syscall: "spawn git" }), undefined],
    [Object.assign(new Error("read failed"), { code: "EAGAIN", syscall: "read" }), undefined],
  ] as const) {
    let starts = 0;
    await assert.rejects(
      startWithRecovery(
        () => {
          starts++;
          return refused(error, pid);
        },
        {
          wait: async () => {
            assert.fail("must not back off or replay");
          },
        },
      ),
      (e) => e === error,
    );
    assert.equal(starts, 1);
  }
});

it("cancellation before startup and during admission backoff cannot launch a command", async () => {
  const controller = new AbortController();
  let starts = 0;
  await assert.rejects(
    startWithRecovery(
      () => {
        starts++;
        return refused(admissionError());
      },
      {
        signal: controller.signal,
        wait: async () => {
          controller.abort();
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(starts, 1);
  await assert.rejects(
    startWithRecovery(
      () => {
        starts++;
        return refused(admissionError());
      },
      {
        signal: controller.signal,
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(starts, 1);
});
