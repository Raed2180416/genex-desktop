/**
 * `StudioCore.stop` on quit: one failing step must not skip the ones after it (review PROD-9),
 * or a connector, the harness host or the budget flush would be left behind. And the harness,
 * which runs detached in its own process group, must be gone when the app exits, however long
 * the connectors and previews take to close (B3).
 */
import assert from "node:assert/strict";
import { it } from "node:test";
import { runShutdown, settleWithin, shutdownSteps, type ShutdownTimers } from "../../src/main/app-lifecycle.ts";
import { startRig } from "../helpers/studio-rig.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** Whether `pid` is gone within a second (Node reaps an exited child on its next turn). */
async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  return !alive(pid);
}

it("a plugin turn lease whose release fails does not skip the rest of the shutdown (PROD-9)", async () => {
  const rig = await startRig();
  let closed = false;
  try {
    rig.core.plugins.lease = () => async () => {
      throw new Error("release failed");
    };
    await rig.core.append([{ type: "turn_started" }]);
    const close = rig.core.mcp.close.bind(rig.core.mcp);
    rig.core.mcp.close = async () => {
      closed = true;
      await close();
    };
    await rig.core.stop();
    assert.equal(closed, true, "connectors were still closed after the failed release");
  } finally {
    await rig.core.host.stop().catch(() => {});
    await rig.stop().catch(() => {});
  }
});

it("stopping the core stops the harness before anything that can hang, such as closing connectors (B3)", async () => {
  const rig = await startRig();
  const close = rig.core.mcp.close.bind(rig.core.mcp);
  try {
    const pid = rig.core.host.pid;
    assert.ok(pid && alive(pid), "the rig's harness is running");
    rig.core.mcp.close = () => new Promise<void>(() => {});
    await settleWithin(rig.core.stop(), 4_000, undefined);
    assert.equal(await gone(pid), true, "the harness outlived a quit whose connector close hung");
  } finally {
    rig.core.mcp.close = close;
    await close().catch(() => {});
    await rig.core.host.stop().catch(() => {});
    await rig.stop().catch(() => {});
  }
});

it("quitting kills a harness that will not stop, as the last step before the app exits (B3)", async () => {
  const rig = await startRig();
  const stop = rig.core.host.stop.bind(rig.core.host);
  try {
    const pid = rig.core.host.pid;
    assert.ok(pid && alive(pid), "the rig's harness is running");
    rig.core.host.stop = () => new Promise<void>(() => {});
    // Every bound a twentieth as long, so the test does not wait out the real quit budget.
    const quick: ShutdownTimers = {
      setTimeout: (run, ms) => setTimeout(run, ms / 20),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const idle = { release() {}, dismiss() {}, cancel() {}, dispose() {} };
    const failed = await runShutdown(
      shutdownSteps({ keepAwake: idle, codexLogin: idle, claudeLogin: idle, terminals: idle, core: rig.core }),
      { log: () => {}, timers: quick },
    );
    assert.deepEqual(failed, ["stop the harness", "stop the studio core"]);
    assert.equal(await gone(pid), true, "the harness outlived the quit");
  } finally {
    rig.core.host.stop = stop;
    await stop().catch(() => {});
    await rig.stop().catch(() => {});
  }
});
