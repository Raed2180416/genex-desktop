/**
 * PH-3: a per-run network overlay (the "Install packages" button opening registry.npmjs.org)
 * must reach the filtering proxy. sandbox-runtime's proxy judges every request against its
 * process-wide config, never the per-spawn overlay, so the sandbox has to push the widened
 * allow-list for exactly as long as the run lasts — and put it back however the run ends.
 *
 * A fake runtime stands in for the singleton, so the proxy config can be read at every moment;
 * `sandbox.test.ts` proves the same against the real proxy.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { ProcessSandbox, type SandboxRuntime } from "../../src/substrate/spawn.ts";
import { posixShell } from "../helpers/posix-shell.ts";
import { tmpDir } from "../helpers/tmp.ts";

const REGISTRY = "registry.npmjs.org";

function fakeRuntime(options: { failWrap?: boolean } = {}) {
  type Config = Parameters<SandboxRuntime["updateConfig"]>[0];
  let current: Config | null = null;
  const wraps: string[][] = [];
  const runtime: SandboxRuntime = {
    isSupportedPlatform: () => true,
    checkDependencies: () => ({ errors: [], warnings: [] }),
    initialize: async (config: Config) => {
      current = config;
    },
    reset: async () => {},
    updateConfig: (config: Config) => {
      current = config;
    },
    wrapWithSandboxArgv: (async (command: string) => {
      wraps.push([...(current?.network.allowedDomains ?? [])]);
      if (options.failWrap) throw new Error("wrap failed");
      return { argv: [await posixShell(), "-c", command], env: process.env };
    }) as never,
    annotateStderrWithSandboxFailures: (_command: string, stderr: string) => stderr,
  } as SandboxRuntime;
  return {
    runtime,
    wraps,
    domains: () => [...(current?.network.allowedDomains ?? [])],
    writes: () => [...(current?.filesystem.allowWrite ?? [])],
  };
}

async function sandboxWith(fake: ReturnType<typeof fakeRuntime>) {
  const root = await tmpDir("sandbox-overlay-");
  const sandbox = await ProcessSandbox.create({
    writableRoots: [root],
    scratchDir: path.join(root, "scratch"),
    secretPaths: [],
    runtime: fake.runtime,
  });
  return { sandbox, root };
}

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("PH-3: a per-run domain reaches the proxy for the run, and only the run", () => {
  it("is open while the install runs and closed once it ends", async () => {
    const fake = fakeRuntime();
    const { sandbox, root } = await sandboxWith(fake);
    assert.deepEqual(fake.domains(), [], "no network by default");
    const run = sandbox.run({ command: "sleep 0.3", cwd: root, policy: { allowedDomains: [REGISTRY] } });
    await until(() => fake.wraps.length === 1);
    assert.deepEqual(fake.wraps[0], [REGISTRY], "the proxy already allows the registry when the command is wrapped");
    assert.deepEqual(fake.domains(), [REGISTRY], "and still does while it runs");
    assert.equal((await run).code, 0);
    assert.deepEqual(fake.domains(), [], "closed again afterwards");
  });

  it("is closed again when the command fails", async () => {
    const fake = fakeRuntime();
    const { sandbox, root } = await sandboxWith(fake);
    const result = await sandbox.run({ command: "exit 3", cwd: root, policy: { allowedDomains: [REGISTRY] } });
    assert.equal(result.code, 3);
    assert.deepEqual(fake.wraps[0], [REGISTRY]);
    assert.deepEqual(fake.domains(), []);
  });

  it("is closed again when the sandbox cannot even start the command", async () => {
    const fake = fakeRuntime({ failWrap: true });
    const { sandbox, root } = await sandboxWith(fake);
    await assert.rejects(
      () => sandbox.run({ command: "true", cwd: root, policy: { allowedDomains: [REGISTRY] } }),
      /wrap failed/,
    );
    assert.deepEqual(fake.wraps[0], [REGISTRY]);
    assert.deepEqual(fake.domains(), []);
  });

  it("two overlapping installs share the opening: the first to finish does not close it on the second", async () => {
    const fake = fakeRuntime();
    const { sandbox, root } = await sandboxWith(fake);
    const long = sandbox.run({ command: "sleep 0.4", cwd: root, policy: { allowedDomains: [REGISTRY] } });
    await sandbox.run({ command: "true", cwd: root, policy: { allowedDomains: [REGISTRY] } });
    assert.deepEqual(fake.domains(), [REGISTRY], "the longer install is still running");
    await long;
    assert.deepEqual(fake.domains(), []);
  });

  it("a folder opened mid-install survives the close, and the opening survives the folder", async () => {
    const fake = fakeRuntime();
    const { sandbox, root } = await sandboxWith(fake);
    const extra = path.join(await tmpDir("sandbox-overlay-later-"), "later");
    const run = sandbox.run({ command: "sleep 0.2", cwd: root, policy: { allowedDomains: [REGISTRY] } });
    await until(() => fake.wraps.length === 1);
    sandbox.allowWrite(extra);
    assert.deepEqual(fake.domains(), [REGISTRY], "opening a folder does not close the registry on a running install");
    await run;
    // On Windows the folder's regrant starts as the install ends, and the closing reaches the
    // proxy once that regrant is applied: wait for it rather than sample the moment between.
    await until(() => fake.domains().length === 0, 15_000);
    assert.ok(fake.writes().includes(extra), "closing the registry does not take the folder back");
  });

  it("a run with no overlay pushes nothing", async () => {
    const fake = fakeRuntime();
    const { sandbox, root } = await sandboxWith(fake);
    let pushes = 0;
    const update = fake.runtime.updateConfig;
    fake.runtime.updateConfig = ((config: Parameters<typeof update>[0]) => {
      pushes++;
      update(config);
    }) as typeof update;
    await sandbox.run({ command: "true", cwd: root });
    assert.equal(pushes, 0);
  });
});
