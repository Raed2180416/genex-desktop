/**
 * The campaign budget and quota guard: hour and run caps, sleeping until a window resets only when
 * that lands inside the budget, stopping otherwise, and a window that reset during a run making its
 * delta unavailable instead of a number. The clock and quota reads are fakes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BudgetStop,
  budgetCaps,
  budgetStop,
  countRun,
  engineQuotaReader,
  guardQuota,
  MAX_QUOTA_WAITS,
  QUOTA_RESET_MARGIN_MS,
  quotaDeltaPoints,
  quotaDeltas,
  type QuotaReader,
  startBudget,
} from "../../scripts/evals/budget.ts";
import { evalsLayout } from "../../scripts/evals/lanes/homes.ts";
import { UnavailableReason } from "../../scripts/evals/vocabulary.ts";
import { HOUR_MS, MINUTE_MS } from "../../src/shared/duration.ts";
import type { ProviderUsage } from "../../src/shared/provider-usage.ts";
import { EngineId } from "../../src/shared/providers.ts";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const usage = (percent: number | null, resetsAt?: string): ProviderUsage => ({
  measuredAt: new Date(T0).toISOString(),
  windows: [{ id: "five_hour", label: "5h", percent, ...(resetsAt ? { resetsAt } : {}) }],
});
const at = (ms: number) => new Date(T0 + ms).toISOString();

/** A fake clock whose sleep moves time, and a reader that answers from a script. */
function fakes(answers: Array<ProviderUsage | null>) {
  let now = T0;
  const slept: number[] = [];
  const read: QuotaReader = async () => answers.shift() ?? null;
  const sleep = async (ms: number): Promise<void> => {
    slept.push(ms);
    now += ms;
  };
  return { clock: { now: () => now, sleep }, read, slept };
}

describe("budget caps", () => {
  it("stops on hours and on runs, and refuses caps out of range", () => {
    const budget = startBudget(budgetCaps({ hours: 2, maxRuns: 2 }), T0);
    assert.equal(budgetStop(budget, T0), null);
    assert.equal(budgetStop(countRun(countRun(budget)), T0), BudgetStop.Runs);
    assert.equal(budgetStop(budget, T0 + 2 * HOUR_MS), BudgetStop.Hours);
    assert.equal(budgetCaps().hours, 8);
    assert.equal(budgetCaps().maxQuotaPercent, 70);
    for (const bad of [
      { hours: 0 },
      { maxRuns: 0 },
      { maxRuns: 1.5 },
      { maxQuotaPercent: 101 },
      { maxQuotaPercent: 0 },
    ])
      assert.throws(() => budgetCaps(bad), RangeError);
  });
});

describe("quota guard", () => {
  const budget = startBudget(budgetCaps({ hours: 8, maxQuotaPercent: 70 }), T0);

  it("proceeds under the ceiling without sleeping", async () => {
    const f = fakes([usage(40, at(HOUR_MS))]);
    const outcome = await guardQuota({ engine: EngineId.ClaudeCode, budget, read: f.read, clock: f.clock });
    assert.deepEqual(outcome, { proceed: true, usage: usage(40, at(HOUR_MS)), waitedMs: 0 });
  });

  it("proceeds when quota cannot be read, leaving the reading null", async () => {
    const f = fakes([null]);
    const outcome = await guardQuota({ engine: EngineId.Codex, budget, read: f.read, clock: f.clock });
    assert.equal(outcome.proceed, true);
    assert.equal(outcome.usage, null);
  });

  it("sleeps until the window resets when that lands inside the budget, then proceeds", async () => {
    const f = fakes([usage(85, at(HOUR_MS)), usage(3, at(6 * HOUR_MS))]);
    const outcome = await guardQuota({ engine: EngineId.ClaudeCode, budget, read: f.read, clock: f.clock });
    assert.equal(outcome.proceed, true);
    assert.deepEqual(f.slept, [HOUR_MS + QUOTA_RESET_MARGIN_MS]);
    assert.equal(outcome.waitedMs, HOUR_MS + QUOTA_RESET_MARGIN_MS);
  });

  it("stops when the reset lands past the budget, when no reset is named, or after the waits run out", async () => {
    const late = fakes([usage(90, at(9 * HOUR_MS))]);
    const lateOutcome = await guardQuota({ engine: EngineId.ClaudeCode, budget, read: late.read, clock: late.clock });
    assert.deepEqual([lateOutcome.proceed, late.slept], [false, []]);
    const unnamed = fakes([usage(90)]);
    const unnamedOutcome = await guardQuota({
      engine: EngineId.ClaudeCode,
      budget,
      read: unnamed.read,
      clock: unnamed.clock,
    });
    assert.equal(unnamedOutcome.proceed, false);
    const stuck = fakes(Array.from({ length: MAX_QUOTA_WAITS + 1 }, (_, i) => usage(90, at((i + 1) * 10 * MINUTE_MS))));
    const stuckOutcome = await guardQuota({ engine: EngineId.Codex, budget, read: stuck.read, clock: stuck.clock });
    assert.equal(stuckOutcome.proceed, false);
    assert.equal(stuck.slept.length, MAX_QUOTA_WAITS);
    if (!stuckOutcome.proceed) assert.equal(stuckOutcome.stop, BudgetStop.Quota);
  });
});

describe("quota deltas", () => {
  it("records each window before and after, and a reset inside the run makes the delta unavailable", () => {
    const before = usage(20, at(HOUR_MS));
    const same = quotaDeltas(before, usage(35, at(HOUR_MS)));
    assert.deepEqual(same, [
      {
        windowId: "five_hour",
        before: 20,
        after: 35,
        resetsAtBefore: at(HOUR_MS),
        resetsAtAfter: at(HOUR_MS),
        resetInside: false,
      },
    ]);
    assert.equal(quotaDeltaPoints(same[0] ?? assert.fail()), 15);
    const reset = quotaDeltas(before, usage(5, at(6 * HOUR_MS)));
    assert.equal(reset[0]?.resetInside, true);
    assert.deepEqual(quotaDeltaPoints(reset[0] ?? assert.fail()), {
      unavailable: true,
      reason: UnavailableReason.WindowReset,
    });
    const fell = quotaDeltas(usage(50), usage(10));
    assert.equal(fell[0]?.resetInside, true);
    const missing = quotaDeltas(null, usage(10));
    assert.deepEqual(quotaDeltaPoints(missing[0] ?? assert.fail()), {
      unavailable: true,
      reason: UnavailableReason.NotRecorded,
    });
  });
});

describe("engine quota reader", () => {
  it("reads nothing while this process's home variables name other homes", async () => {
    const layout = evalsLayout("/nonexistent/evals");
    const read = engineQuotaReader(layout, { CLAUDE_CONFIG_DIR: "/home/op/.claude", CODEX_HOME: "/home/op/.codex" });
    assert.equal(await read(EngineId.ClaudeCode), null);
    assert.equal(await read(EngineId.Codex), null);
  });
});
