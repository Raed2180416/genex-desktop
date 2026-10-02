/**
 * sandbox-runtime is one per process, and it holds the process open until it is reset: on Linux
 * its socat bridges are child processes, so a test file whose sandbox was never released never
 * exited and held a `node --test` slot until the CI job timed out. The last enabled macOS or Linux
 * sandbox to be disposed resets it; a stopped core disposes its own.
 *
 * A fake runtime counts the calls; the core case drives the real one.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { StudioPlatform } from "../../src/shared/boot.ts";
import { ProcessSandbox, type SandboxRuntime } from "../../src/substrate/spawn.ts";
import { coreLite } from "../helpers/core-lite.ts";
import { tmpDir } from "../helpers/tmp.ts";

/** A sandbox-runtime stand-in that records `initialize` and `reset`; `reset` waits for `gate`. */
function countingRuntime(gate: Promise<void> = Promise.resolve()) {
  const calls: string[] = [];
  const runtime = {
    isSupportedPlatform: () => true,
    checkDependencies: () => ({ errors: [], warnings: [] }),
    initialize: async () => {
      calls.push("initialize");
    },
    reset: async () => {
      calls.push("reset");
      await gate;
      calls.push("reset done");
    },
    updateConfig: () => {},
    wrapWithSandboxArgv: async () => {
      throw new Error("this test starts no process");
    },
    annotateStderrWithSandboxFailures: (_command: string, stderr: string) => stderr,
  } as unknown as SandboxRuntime;
  return { runtime, calls };
}

async function sandboxOn(runtime: SandboxRuntime, platform: NodeJS.Platform, enabled = true) {
  const root = await tmpDir("sandbox-release-");
  return ProcessSandbox.create({
    writableRoots: [root],
    scratchDir: path.join(root, "scratch"),
    secretPaths: [],
    runtime,
    platform,
    enabled,
  });
}

for (const platform of [StudioPlatform.Mac, StudioPlatform.Linux]) {
  describe(`releasing sandbox-runtime on ${platform}`, () => {
    it("resets it when the last sandbox sharing it is disposed, and only then", async () => {
      const { runtime, calls } = countingRuntime();
      const first = await sandboxOn(runtime, platform);
      const second = await sandboxOn(runtime, platform);
      const off = await sandboxOn(runtime, platform, false);
      await first.dispose();
      await off.dispose();
      assert.deepEqual(calls, ["initialize", "initialize"], "another sandbox still uses it");
      await second.dispose();
      await second.dispose();
      await first.dispose();
      assert.deepEqual(calls, ["initialize", "initialize", "reset", "reset done"]);
    });

    it("initializes it again for a sandbox created after the release, once the reset has finished", async () => {
      let finish = () => {};
      const { runtime, calls } = countingRuntime(new Promise<void>((resolve) => (finish = resolve)));
      const first = await sandboxOn(runtime, platform);
      const disposed = first.dispose();
      const next = sandboxOn(runtime, platform);
      await new Promise((resolve) => setImmediate(resolve));
      finish();
      await Promise.all([disposed, next]);
      assert.deepEqual(calls, ["initialize", "reset", "reset done", "initialize"]);
      await (await next).dispose();
      assert.deepEqual(calls.slice(-2), ["reset", "reset done"]);
    });
  });
}

describe("a stopped core", {
  skip: process.platform === "win32" && "Windows releases through its grant session",
}, () => {
  it("has released the real sandbox-runtime", async () => {
    const lite = await coreLite({ sandbox: true });
    assert.equal(lite.core.sandbox.enabled, true);
    assert.equal(typeof SandboxManager.getProxyPort(), "number", "the core's sandbox started the proxy");
    await lite.close();
    assert.equal(SandboxManager.getProxyPort(), undefined);
  });
});
