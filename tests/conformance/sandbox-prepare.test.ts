import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareSandbox } from "../../src/substrate/sandbox-prepare.ts";

const lookupError = () => new Error("Shell '/bin/bash' not found in PATH");
test("sandbox preparation recovers a transient lookup without replaying a command", async () => {
  let attempts = 0,
    checks = 0,
    executions = 0;
  const command = await prepareSandbox(
    async () => {
      if (++attempts < 3) throw lookupError();
      return () => {
        executions++;
      };
    },
    {
      platform: "darwin",
      checkShell: async () => {
        checks++;
      },
    },
  );
  assert.equal(executions, 0);
  command();
  assert.deepEqual({ attempts, checks, executions }, { attempts: 3, checks: 2, executions: 1 });
});
test("sandbox preparation fails closed for missing shells, other errors and exhausted lookup attempts", async () => {
  let attempts = 0;
  const prepare = async () => {
    attempts++;
    throw lookupError();
  };
  await assert.rejects(
    prepareSandbox(prepare, {
      platform: "darwin",
      checkShell: async () => {
        throw new Error("EACCES");
      },
    }),
    /EACCES/,
  );
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(
    prepareSandbox(prepare, { platform: "darwin", checkShell: async () => {} }),
    /three preparation attempts.*No command was started/,
  );
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(
    prepareSandbox(
      async () => {
        attempts++;
        throw new Error("invalid sandbox policy");
      },
      { platform: "darwin" },
    ),
    /invalid sandbox policy/,
  );
  assert.equal(attempts, 1);
});
test("Stop during shell preparation prevents another attempt and command launch", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    prepareSandbox(
      async () => {
        attempts++;
        throw lookupError();
      },
      {
        platform: "darwin",
        signal: controller.signal,
        checkShell: async () => {
          controller.abort(new Error("stopped"));
        },
      },
    ),
    /stopped/,
  );
  assert.equal(attempts, 1);
});

test("installed sandbox lookup resolves absolute executables even without a PATH utility", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const path = await import("node:path");
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("@anthropic-ai/sandbox-runtime/package.json");
  const { whichSync } = await import(pathToFileURL(path.join(path.dirname(pkg), "dist/utils/which.js")).href);
  const os = await import("node:os");
  const previous = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    // This Node binary is an absolute executable on every platform; /bin/bash is not on Windows.
    assert.equal(whichSync(process.execPath), process.execPath);
    assert.equal(whichSync(path.join(os.tmpdir(), "no-such-shell")), null);
    assert.equal(whichSync(os.tmpdir()), null);
  } finally {
    process.env.PATH = previous;
  }
});
