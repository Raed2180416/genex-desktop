import assert from "node:assert/strict";
import test from "node:test";
import { PreviewPool } from "../../src/substrate/preview-pool.ts";
import type { PreviewPort } from "../../src/substrate/preview-port.ts";

const live = {} as PreviewPort;
function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("preview pool reserves capacity while a port is being created", async () => {
  const creation = deferred<PreviewPort>();
  let creates = 0;
  const pool = new PreviewPool({
    live,
    max: 1,
    createHeadless: () => {
      creates++;
      return creation.promise;
    },
  });
  const first = pool.acquire({ label: "first" });
  const second = pool.acquire({ label: "second" });
  creation.resolve(live);
  await first;
  await assert.rejects(second, /pool exhausted/);
  assert.equal(creates, 1);
});

test("preview pool holds capacity until disposal completes and duplicate releases await it", async () => {
  const disposal = deferred<void>();
  const port = { dispose: () => disposal.promise } as PreviewPort;
  const pool = new PreviewPool({ live, max: 1, createHeadless: async () => port });
  const lease = await pool.acquire({ label: "first" });
  const releasing = pool.release(lease.handle);
  let done = false;
  const duplicate = pool.release(lease.handle).then(() => {
    done = true;
  });
  const acquiring = pool.acquire({ label: "second" });
  await Promise.resolve();
  assert.equal(done, false);
  disposal.resolve();
  await Promise.all([releasing, duplicate]);
  await assert.rejects(acquiring, /pool exhausted/);
  await pool.acquire({ label: "after cleanup" });
});

test("failed creation returns reserved capacity", async () => {
  let first = true;
  const pool = new PreviewPool({
    live,
    max: 1,
    createHeadless: async () => {
      if (first) {
        first = false;
        throw new Error("creation failed");
      }
      return live;
    },
  });
  await assert.rejects(pool.acquire({ label: "failed" }), /creation failed/);
  await pool.acquire({ label: "retry" });
});

test("disposing the pool waits for an in-flight acquisition and destroys its port", async () => {
  const creation = deferred<PreviewPort>();
  let disposed = 0;
  const pool = new PreviewPool({ live, max: 1, createHeadless: () => creation.promise });
  const acquiring = pool.acquire({ label: "pending" });
  const stopping = pool.disposeAll();
  creation.resolve({
    dispose: async () => {
      disposed++;
    },
  } as PreviewPort);
  await Promise.all([acquiring, stopping]);
  assert.equal(disposed, 1);
  assert.equal(pool.leaseCount, 0);
});

test("failed cleanup retains capacity instead of reusing an uncleared session", async () => {
  const pool = new PreviewPool({
    live,
    max: 1,
    createHeadless: async () =>
      ({
        dispose: async (): Promise<void> => {
          throw new Error("cleanup failed");
        },
      }) as PreviewPort,
  });
  const lease = await pool.acquire({ label: "first" });
  await assert.rejects(pool.release(lease.handle), /cleanup failed/);
  await assert.rejects(pool.acquire({ label: "unsafe replacement" }), /pool exhausted/);
  await assert.rejects(pool.release(lease.handle), /cleanup failed/);
});
