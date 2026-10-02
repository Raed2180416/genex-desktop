/**
 * The shared fakes and probes other suites build on: a renderer `window.studio`, a harness `ctx`,
 * whether a process still runs, and the check every test file runs for the child processes it
 * leaves. Their own contract, so a consumer's failure is about the code under test and not about
 * the helper.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { TEST_PRELOAD, testEnv } from "../../scripts/affected-tests.mjs";
import { SECOND_MS } from "../../src/shared/duration.ts";
import { ctxRecorder } from "../helpers/ctx-recorder.ts";
import { fakeStudioApi, installFakeStudio, STUDIO_METHODS } from "../helpers/fake-studio-api.ts";
import { EXIT_GRACE_ENV } from "../helpers/leftover-children.ts";
import { running } from "../helpers/processes.ts";
import { tmpDir } from "../helpers/tmp.ts";

describe("fakeStudioApi", () => {
  it("answers every named call with a default, records it, and lets a test replace one", async () => {
    const studio = fakeStudioApi();
    for (const method of STUDIO_METHODS) assert.equal(typeof studio.api[method], "function", method);
    assert.deepEqual(await studio.api.games(), []);
    assert.equal((await studio.api.bootstrap()).threadId, "thread-main");
    studio.stub("renameThread", async () => undefined as never);
    await studio.api.renameThread("t1", "Pong");
    assert.deepEqual(studio.callsOf("renameThread"), [["t1", "Pong"]]);
    assert.deepEqual(
      studio.calls.map((call) => call.method),
      ["games", "bootstrap", "renameThread"],
    );
  });

  it("in strict mode refuses any call the test did not stub", async () => {
    const studio = fakeStudioApi({ games: async () => [] }, { strict: true });
    assert.deepEqual(await studio.api.games(), []);
    await assert.rejects(studio.api.stopRun("run-a"), /stopRun is not stubbed/);
  });

  it("delivers pushes to subscribed listeners until they unsubscribe", () => {
    const studio = fakeStudioApi();
    const heard: unknown[] = [];
    const off = studio.api.onEvent((event) => heard.push(event));
    assert.equal(studio.listeners("onEvent"), 1);
    studio.emit({ type: "chat.error", payload: {} });
    off();
    studio.emit({ type: "chat.error", payload: {} });
    assert.equal(heard.length, 1);
    assert.equal(studio.listeners("onEvent"), 0);
  });

  it("installs as window.studio and restores what was there", () => {
    const studio = fakeStudioApi();
    const restore = installFakeStudio(studio);
    assert.equal((globalThis as { window?: { studio?: unknown } }).window?.studio, studio.api);
    restore();
    assert.equal("window" in globalThis, false);
  });
});

describe("ctxRecorder", () => {
  it("records calls in order, answers snapshot defaults and refuses an unknown method like the host", async () => {
    const recorder = ctxRecorder();
    const first = await recorder.ctx.call("snapshot.create", { scope: "game", reason: "before" });
    const second = await recorder.ctx.call("snapshot.create", { scope: "game", reason: "after" });
    assert.deepEqual([first.snapshot_id, second.snapshot_id], ["snap-1", "snap-2"]);
    await recorder.ctx.call("snapshot.restore", { snapshotId: first.snapshot_id });
    await assert.rejects(
      recorder.ctx.call("brand.new"),
      (err: Error) => err.name === "UnknownMethod" && /brand\.new/.test(err.message),
    );
    assert.deepEqual(recorder.sequence("snapshot."), ["snapshot.create", "snapshot.create", "snapshot.restore"]);
    assert.deepEqual(recorder.paramsOf("snapshot.restore"), [{ snapshotId: "snap-1" }]);
  });

  it("raises the stop flag on the nth call of a method, as the user's Stop would", async () => {
    const recorder = ctxRecorder({ handlers: { "turn.step": () => true } });
    recorder.cancelAfter("turn.step", 2);
    await recorder.ctx.call("turn.step");
    assert.equal(recorder.ctx.cancelled, false);
    await recorder.ctx.call("turn.step");
    assert.equal(recorder.ctx.cancelled, true);
  });

  it("refuses a path-bearing call the host's params check would refuse, before any handler runs", async () => {
    let ran = 0;
    const recorder = ctxRecorder({ handlers: { "snapshot.worktree": () => ++ran } });
    await assert.rejects(
      recorder.ctx.call("snapshot.worktree", { project: "pong", name: "a", runId: 7 }),
      (err: Error & { data?: { method: string; issues: Array<{ path: string }> } }) =>
        err.name === "InvalidParams" &&
        err.data?.method === "snapshot.worktree" &&
        err.data.issues.some((issue) => issue.path === "runId"),
    );
    assert.equal(ran, 0);
    assert.equal(await recorder.ctx.call("snapshot.worktree", { project: "pong", name: "a", runId: "run-1" }), 1);
    // Methods the host does not check keep answering whatever they are sent.
    await recorder.ctx.call("snapshot.markHealthy", { snapshotId: 1 });
  });
});

describe("running", { skip: process.platform === "win32" && "Windows has no process states to read" }, () => {
  // The child exits at once; its parent hears SIGCHLD, prints the child's pid and never reaps it.
  const UNREAPED =
    'my $exited = 0; $SIG{CHLD} = sub { $exited = 1 }; my $pid = fork(); if ($pid == 0) { exit 0; } sleep 1 until $exited; $| = 1; print "$pid\\n"; sleep 30;';

  it("counts a process that exited but is not reaped yet as stopped, though kill(pid, 0) still finds it", async () => {
    const parent = spawn("/usr/bin/perl", ["-e", UNREAPED], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      const [line] = await once(parent.stdout, "data");
      const child = Number(String(line).trim());
      assert.ok(child > 0, String(line));
      assert.doesNotThrow(() => process.kill(child, 0), "the exited child is still in the process table");
      assert.equal(running(child), false, "an exited child is not running");
      assert.ok(parent.pid);
      assert.equal(running(parent.pid), true, "its sleeping parent is");
    } finally {
      parent.kill("SIGKILL");
    }
  });
});

describe("leftover children", { skip: process.platform === "win32" && "reads process states with ps" }, () => {
  /** A cap on the nested run, so a check that stopped working fails here instead of hanging. */
  const RUN_CAP_MS = 60 * SECOND_MS;

  /** Run one test file the way the runners do, with the check preloaded. */
  async function runFile(name: string, body: string, env: NodeJS.ProcessEnv = {}) {
    const dir = await tmpDir("leftover-children-");
    const file = path.join(dir, name);
    await writeFile(
      file,
      `import { spawn } from "node:child_process";\nimport { test } from "node:test";\ntest("starts a child", () => {\n${body}\n});\n`,
    );
    return spawnSync(process.execPath, [...TEST_PRELOAD, "--test", "--test-reporter=spec", file], {
      cwd: dir,
      env: { ...testEnv(), ...env },
      encoding: "utf8",
      timeout: RUN_CAP_MS,
    });
  }

  it("fails a file that leaves a child running, names both, and kills the child so the file exits", async () => {
    const left = await runFile(
      "leaks.test.mjs",
      'spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      { [EXIT_GRACE_ENV]: "0" },
    );
    assert.equal(left.error, undefined, "the file exited on its own");
    assert.equal(left.status, 1, left.stdout);
    assert.match(left.stdout, /leaks\.test\.mjs left 1 child process\(es\) running after its cleanup/);
    const pid = Number(/pid (\d+): .*setInterval/.exec(left.stdout)?.[1]);
    assert.ok(pid > 0, left.stdout);
    assert.equal(running(pid), false, "the child it named is gone");
  });

  it("passes a file whose child is still exiting when its tests end", async () => {
    const exiting = await runFile(
      "exiting.test.mjs",
      'spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: "ignore" });',
    );
    assert.equal(exiting.error, undefined);
    assert.equal(exiting.status, 0, exiting.stdout);
  });
});
