/**
 * The machine-wide probe lock (Rule 11): one probe at a time per machine, at an explicit path under
 * `$GENEX_EVALS_HOME`, broken when its holder is gone or it is older than the staleness window, and
 * refusing every hostile location with no side effect. Time, sleeps and liveness are injected.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PROBE_LOCK_STALE_MS,
  ProbeLockError,
  ProbeLockErrorCode,
  probeLockPath,
  withProbeLock,
} from "../../scripts/evals/prober/lock.ts";
import { tmpDir } from "../helpers/tmp.ts";

/** A fake clock whose sleeps advance it, and a liveness table the test controls. */
function fakeDeps(start = 1_000_000) {
  let now = start;
  const alive = new Set<number>();
  const slept: number[] = [];
  return {
    alive,
    slept,
    deps: {
      pid: 4242,
      now: () => now,
      sleep: async (ms: number) => {
        slept.push(ms);
        now += ms;
      },
      isAlive: (pid: number) => alive.has(pid),
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function evalsHome(): Promise<string> {
  return fs.realpathSync(await tmpDir("eval-prober-lock-"));
}

describe("probe lock path", () => {
  it("lives under $GENEX_EVALS_HOME/locks", async () => {
    const home = await evalsHome();
    assert.equal(probeLockPath({ GENEX_EVALS_HOME: home }), path.join(home, "locks", "probe.lock"));
  });

  const hostile: Array<{ name: string; env: Record<string, string>; code: ProbeLockErrorCode }> = [
    { name: "unset", env: {}, code: ProbeLockErrorCode.EvalsHomeMissing },
    { name: "empty", env: { GENEX_EVALS_HOME: "" }, code: ProbeLockErrorCode.EvalsHomeMissing },
    { name: "relative", env: { GENEX_EVALS_HOME: "relative/evals" }, code: ProbeLockErrorCode.EvalsHomeNotAbsolute },
    { name: "NUL byte", env: { GENEX_EVALS_HOME: "/tmp/evals\0x" }, code: ProbeLockErrorCode.EvalsHomeNotAbsolute },
  ];
  for (const row of hostile) {
    it(`refuses an evals home that is ${row.name}, creating nothing`, () => {
      const before = fs.readdirSync(process.cwd());
      assert.throws(
        () => probeLockPath(row.env),
        (e: unknown) => e instanceof ProbeLockError && e.code === row.code,
      );
      assert.deepEqual(fs.readdirSync(process.cwd()), before);
    });
  }
});

describe("withProbeLock", () => {
  it("holds the lock with its pid while the work runs and removes it afterwards", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    const { deps } = fakeDeps();
    const seen = await withProbeLock(lock, async () => fs.readFileSync(lock, "utf8"), deps);
    assert.equal(seen.trim(), "4242");
    assert.equal(fs.existsSync(lock), false);
  });

  it("removes the lock when the work throws", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    const { deps } = fakeDeps();
    await assert.rejects(
      withProbeLock(lock, async () => Promise.reject(new Error("probe crashed")), deps),
      /probe crashed/,
    );
    assert.equal(fs.existsSync(lock), false);
  });

  it("is re-entrant inside one process: a nested probe under the same lock runs at once", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    const { deps, slept } = fakeDeps();
    const inner = await withProbeLock(lock, () => withProbeLock(lock, async () => "nested", deps), deps);
    assert.equal(inner, "nested");
    assert.deepEqual(slept, []);
    assert.equal(fs.existsSync(lock), false);
  });

  it("an unrelated concurrent probe in the same process waits for the holder instead of joining it", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    const f = fakeDeps();
    f.alive.add(4242);
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withProbeLock(
      lock,
      async () => {
        order.push("first:start");
        await firstHeld;
        order.push("first:end");
      },
      f.deps,
    );
    const sleep = async (ms: number) => {
      await f.deps.sleep(ms);
      releaseFirst();
      await first;
    };
    await withProbeLock(lock, async () => order.push("second"), { ...f.deps, sleep });
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
  });

  it("waits while a live holder has it, then takes it once the holder is gone", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "777");
    const f = fakeDeps();
    f.alive.add(777);
    let polls = 0;
    const sleep = async (ms: number) => {
      await f.deps.sleep(ms);
      polls++;
      if (polls === 2) f.alive.delete(777);
    };
    const ran = await withProbeLock(lock, async () => fs.readFileSync(lock, "utf8"), { ...f.deps, sleep });
    assert.equal(ran, "4242");
    assert.equal(polls, 2);
  });

  it("a live holder that keeps its heartbeat is never broken, however long it holds the lock", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    let now = Date.now();
    const ticks: Array<() => void> = [];
    const alive = new Set([111, 222]);
    const shared = {
      now: () => now,
      isAlive: (pid: number) => alive.has(pid),
      every: (_ms: number, tick: () => void) => {
        ticks.push(tick);
        return () => {
          ticks.splice(ticks.indexOf(tick), 1);
        };
      },
    };
    let inside = 0;
    let maxInside = 0;
    const enter = async (work: Promise<void>) => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await work;
      inside -= 1;
    };
    let releaseHolder = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holder = withProbeLock(lock, () => enter(held), { ...shared, pid: 111, sleep: async () => {} });
    await Promise.resolve();
    const waiter = withProbeLock(lock, () => enter(Promise.resolve()), {
      ...shared,
      pid: 222,
      waitMs: 2 * PROBE_LOCK_STALE_MS,
      sleep: async (ms: number) => {
        now += ms;
        for (const tick of [...ticks]) tick();
      },
    });
    await assert.rejects(waiter, (e: unknown) => e instanceof ProbeLockError && e.code === ProbeLockErrorCode.Timeout);
    assert.equal(maxInside, 1);
    assert.equal(fs.readFileSync(lock, "utf8"), "111");
    releaseHolder();
    await holder;
    assert.deepEqual(ticks, [], "the heartbeat stops when the holder releases");
  });

  it("two waiters that both find a stale lock: one takes it, and neither removes the other's fresh lock", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "777");
    let now = fs.statSync(lock).mtimeMs;
    const alive = new Set([111, 222]);
    let inside = 0;
    let maxInside = 0;
    let releaseFirst = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const enter = async (work: Promise<void>) => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await work;
      inside -= 1;
    };
    const quiet = { every: () => () => {}, now: () => now };
    let first: Promise<void> | null = null;
    // The second waiter's liveness check of the dead holder is where the first waiter slips in: it
    // breaks the stale lock and takes it before the second one acts on what it saw.
    const isAliveRacing = (pid: number) => {
      if (pid === 777 && first === null) {
        first = withProbeLock(lock, () => enter(firstHeld), {
          ...quiet,
          pid: 111,
          isAlive: (p) => alive.has(p),
          sleep: async () => {},
        });
      }
      return alive.has(pid);
    };
    const second = withProbeLock(lock, () => enter(Promise.resolve()), {
      ...quiet,
      pid: 222,
      isAlive: isAliveRacing,
      sleep: async (ms: number) => {
        now += ms;
        releaseFirst();
        await first;
      },
    });
    await second;
    assert.equal(maxInside, 1);
    assert.equal(fs.existsSync(lock), false);
    assert.deepEqual(fs.readdirSync(path.dirname(lock)), [], "a broken lock leaves no renamed file behind");
  });

  it("breaks a lock whose holder is alive but has stopped its heartbeat for the staleness window (a wedged probe)", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "777");
    const f = fakeDeps(fs.statSync(lock).mtimeMs + PROBE_LOCK_STALE_MS + 1);
    f.alive.add(777);
    assert.equal(await withProbeLock(lock, async () => "took it", f.deps), "took it");
    assert.deepEqual(f.slept, []);
  });

  it("gives up with a typed timeout after its wait budget and leaves the holder's lock alone", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "777");
    const f = fakeDeps(fs.statSync(lock).mtimeMs);
    f.alive.add(777);
    let ran = false;
    await assert.rejects(
      withProbeLock(
        lock,
        async () => {
          ran = true;
        },
        { ...f.deps, waitMs: 10_000 },
      ),
      (e: unknown) => e instanceof ProbeLockError && e.code === ProbeLockErrorCode.Timeout,
    );
    assert.equal(ran, false);
    assert.equal(fs.readFileSync(lock, "utf8"), "777");
  });

  it("does not remove a lock another process took after ours was broken as stale", async () => {
    const home = await evalsHome();
    const lock = probeLockPath({ GENEX_EVALS_HOME: home });
    const { deps } = fakeDeps();
    await withProbeLock(
      lock,
      async () => {
        fs.writeFileSync(lock, "999");
      },
      deps,
    );
    assert.equal(fs.readFileSync(lock, "utf8"), "999");
  });

  describe("hostile lock locations change nothing", () => {
    it("a lock path that is a symlink to an outside file is refused and the target is untouched", async () => {
      const home = await evalsHome();
      const outside = await tmpDir("eval-prober-outside-");
      const target = path.join(outside, "precious.txt");
      fs.writeFileSync(target, "keep me");
      const lock = probeLockPath({ GENEX_EVALS_HOME: home });
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      fs.symlinkSync(target, lock);
      const { deps } = fakeDeps();
      await assert.rejects(
        withProbeLock(lock, async () => "ran", deps),
        (e: unknown) => e instanceof ProbeLockError && e.code === ProbeLockErrorCode.NotRegularFile,
      );
      assert.equal(fs.readFileSync(target, "utf8"), "keep me");
      assert.ok(fs.lstatSync(lock).isSymbolicLink(), "the planted link is left for a human to see");
    });

    it("a locks folder that is a symlink out of the evals home is refused and nothing is written there", async () => {
      const home = await evalsHome();
      const outside = await tmpDir("eval-prober-outside-");
      fs.symlinkSync(outside, path.join(home, "locks"));
      const lock = probeLockPath({ GENEX_EVALS_HOME: home });
      const { deps } = fakeDeps();
      await assert.rejects(
        withProbeLock(lock, async () => "ran", deps),
        (e: unknown) => e instanceof ProbeLockError && e.code === ProbeLockErrorCode.EscapesEvalsHome,
      );
      assert.deepEqual(fs.readdirSync(outside), []);
    });

    it("an evals home that does not exist is refused and not created", async () => {
      const parent = await evalsHome();
      const home = path.join(parent, "missing");
      const lock = probeLockPath({ GENEX_EVALS_HOME: home });
      const { deps } = fakeDeps();
      await assert.rejects(
        withProbeLock(lock, async () => "ran", deps),
        (e: unknown) => e instanceof ProbeLockError && e.code === ProbeLockErrorCode.EvalsHomeMissing,
      );
      assert.equal(fs.existsSync(home), false);
    });
  });
});
