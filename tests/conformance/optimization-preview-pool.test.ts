import assert from "node:assert/strict";
import { it } from "node:test";
import { PreviewPool } from "../../src/substrate/preview-pool.ts";
import type { PreviewPort } from "../../src/substrate/preview-port.ts";

it("only the optimization lease requests a profiling surface; releasing it leaves live untouched", async () => {
  const live = {} as PreviewPort;
  const requests: unknown[] = [];
  let disposed = 0;
  const pool = new PreviewPool({
    live,
    createHeadless: async (options) => {
      requests.push(options);
      return {
        dispose: () => {
          disposed++;
        },
      } as PreviewPort;
    },
  });
  const ordinary = await pool.acquire({ label: "facet" });
  const optimization = await pool.acquire({ label: "optimization:run", purpose: "optimization" });
  assert.deepEqual(requests, [{ purpose: undefined }, { purpose: "optimization" }]);
  assert.equal(pool.port(), live);
  await pool.release(optimization.handle);
  await pool.release(optimization.handle);
  assert.equal(disposed, 1);
  assert.equal(pool.port(), live);
  assert.equal(pool.port(ordinary.handle), ordinary.port);
  await pool.disposeAll();
  assert.equal(disposed, 2);
});
