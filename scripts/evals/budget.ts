/**
 * A campaign's spending caps (§12): wall hours, runs and a quota ceiling per provider window. The
 * quota guard runs before every run and every grading batch: above the ceiling in any window it
 * sleeps until that window resets, when the reset lands inside the budget, and otherwise stops
 * cleanly. Quota is read through the engines' own `readUsage()` against the eval homes, and a
 * window that reset during a run makes its delta unavailable, never a number.
 */
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { HOUR_MS, MINUTE_MS } from "../../src/shared/duration.ts";
import type { CodingProvider } from "../../src/shared/coding-cli.ts";
import type { ProviderUsage } from "../../src/shared/provider-usage.ts";
import { EngineId } from "../../src/shared/providers.ts";
import { type Pinned, type QuotaDelta, unavailable } from "./ledger/types.ts";
import { type EvalsLayout, usesEvalHomes } from "./lanes/homes.ts";
import { UnavailableReason } from "./vocabulary.ts";

/** The default wall budget of a campaign run. */
export const DEFAULT_BUDGET_HOURS = 8;
/** The default quota ceiling, in percent of any window. */
export const DEFAULT_MAX_QUOTA_PERCENT = 70;
/** Slack after a window's stated reset before quota is read again. */
export const QUOTA_RESET_MARGIN_MS = 2 * MINUTE_MS;
/** How many times one guard sleeps for a reset before it gives up. */
export const MAX_QUOTA_WAITS = 3;

/** Why the budget says stop. */
export const BudgetStop = {
  Hours: "budget-hours",
  Runs: "max-runs",
  /** A window stays above the ceiling past the budget, or names no reset. */
  Quota: "quota",
} as const;
export type BudgetStop = (typeof BudgetStop)[keyof typeof BudgetStop];

/** The caps a campaign runs under. */
export interface BudgetCaps {
  hours: number;
  /** null: no cap on runs. */
  maxRuns: number | null;
  maxQuotaPercent: number;
}

/** A running budget: its caps, when it started and how many runs it has started. */
export interface Budget {
  caps: BudgetCaps;
  startedAtMs: number;
  runsStarted: number;
}

/** The time and a sleep, injectable. */
export interface BudgetClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The machine's clock. */
export const SYSTEM_BUDGET_CLOCK: BudgetClock = { now: () => Date.now(), sleep: (ms) => sleep(ms) };

/** Caps from the CLI's numbers, refusing nonsense. */
export function budgetCaps(input: Partial<BudgetCaps> = {}): BudgetCaps {
  const caps: BudgetCaps = {
    hours: input.hours ?? DEFAULT_BUDGET_HOURS,
    maxRuns: input.maxRuns ?? null,
    maxQuotaPercent: input.maxQuotaPercent ?? DEFAULT_MAX_QUOTA_PERCENT,
  };
  const hoursOk = Number.isFinite(caps.hours) && caps.hours > 0;
  const runsOk = caps.maxRuns === null || (Number.isInteger(caps.maxRuns) && caps.maxRuns > 0);
  const quotaOk = caps.maxQuotaPercent > 0 && caps.maxQuotaPercent <= 100;
  if (!(hoursOk && runsOk && quotaOk)) throw new RangeError("budget caps out of range");
  return caps;
}

/** A budget that starts now. */
export function startBudget(caps: BudgetCaps, nowMs: number): Budget {
  return { caps, startedAtMs: nowMs, runsStarted: 0 };
}

/** When the budget's hours run out. */
export function budgetDeadlineMs(budget: Budget): number {
  return budget.startedAtMs + budget.caps.hours * HOUR_MS;
}

/** Whether another run may start now: null, or why not. */
export function budgetStop(budget: Budget, nowMs: number): BudgetStop | null {
  if (nowMs >= budgetDeadlineMs(budget)) return BudgetStop.Hours;
  if (budget.caps.maxRuns !== null && budget.runsStarted >= budget.caps.maxRuns) return BudgetStop.Runs;
  return null;
}

/** The budget with one more run started. */
export function countRun(budget: Budget): Budget {
  return { ...budget, runsStarted: budget.runsStarted + 1 };
}

/** How quota is read for one provider; null when it cannot be read. */
export type QuotaReader = (engine: CodingProvider) => Promise<ProviderUsage | null>;

/** The windows above the ceiling. */
export function windowsOver(usage: ProviderUsage, maxPercent: number): ProviderUsage["windows"] {
  return usage.windows.filter((window) => window.percent !== null && window.percent > maxPercent);
}

/** When every window above the ceiling has reset, or null when one names no reset. */
function allResetAtMs(over: ProviderUsage["windows"]): number | null {
  let latest = 0;
  for (const window of over) {
    const at = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    if (!Number.isFinite(at)) return null;
    latest = Math.max(latest, at);
  }
  return latest;
}

/** What the quota guard decided. */
export type QuotaGuardOutcome =
  | { proceed: true; usage: ProviderUsage | null; waitedMs: number }
  | { proceed: false; stop: BudgetStop; usage: ProviderUsage | null; waitedMs: number };

/**
 * The quota guard for one provider: proceed under the ceiling (or when quota cannot be read, which
 * the row records as unavailable); above it, sleep until the windows reset when that lands inside
 * the budget, at most `MAX_QUOTA_WAITS` times; otherwise stop.
 */
export async function guardQuota(input: {
  engine: CodingProvider;
  budget: Budget;
  read: QuotaReader;
  clock?: BudgetClock;
}): Promise<QuotaGuardOutcome> {
  const clock = input.clock ?? SYSTEM_BUDGET_CLOCK;
  let waitedMs = 0;
  for (let waits = 0; ; waits++) {
    const usage = await input.read(input.engine);
    const over = usage ? windowsOver(usage, input.budget.caps.maxQuotaPercent) : [];
    if (!over.length) return { proceed: true, usage, waitedMs };
    const resetAt = allResetAtMs(over);
    const wakeAt = resetAt === null ? null : resetAt + QUOTA_RESET_MARGIN_MS;
    const fits = wakeAt !== null && wakeAt < budgetDeadlineMs(input.budget) && waits < MAX_QUOTA_WAITS;
    if (!fits || wakeAt === null) return { proceed: false, stop: BudgetStop.Quota, usage, waitedMs };
    const ms = Math.max(0, wakeAt - clock.now());
    await clock.sleep(ms);
    waitedMs += ms;
  }
}

/** Whether a window reset between two readings: its reset moved, or its use fell. */
function resetBetween(before: ProviderUsage["windows"][number], after: ProviderUsage["windows"][number]): boolean {
  const moved = Boolean(before.resetsAt && after.resetsAt && before.resetsAt !== after.resetsAt);
  const fell = before.percent !== null && after.percent !== null && after.percent < before.percent;
  return moved || fell;
}

/** Per-window quota before and after a run, marking any window that reset in between. */
export function quotaDeltas(before: ProviderUsage | null, after: ProviderUsage | null): QuotaDelta[] {
  const ids = [...new Set([...(before?.windows ?? []), ...(after?.windows ?? [])].map((window) => window.id))];
  return ids.map((windowId) => {
    const was = before?.windows.find((window) => window.id === windowId);
    const now = after?.windows.find((window) => window.id === windowId);
    return {
      windowId,
      before: was?.percent ?? null,
      after: now?.percent ?? null,
      resetsAtBefore: was?.resetsAt ?? null,
      resetsAtAfter: now?.resetsAt ?? null,
      resetInside: Boolean(was && now && resetBetween(was, now)),
    };
  });
}

/** A window's quota use in percentage points: unavailable when the window reset inside the run, or a side is missing. */
export function quotaDeltaPoints(delta: QuotaDelta): Pinned<number> {
  if (delta.resetInside) return unavailable(UnavailableReason.WindowReset);
  if (delta.before === null || delta.after === null) return unavailable(UnavailableReason.NotRecorded);
  return delta.after - delta.before;
}

/**
 * The engines' own `readUsage()` against the eval homes. It reads nothing unless this process's
 * `CLAUDE_CONFIG_DIR`/`CODEX_HOME` already name the eval homes (`applyEvalHomesEnv`), because the
 * engines take those variables first and would otherwise read the operator's own account. Claude's
 * status session runs in `judgeCwd`, `<root>/quota-cwd` unless the caller names another.
 */
export function engineQuotaReader(
  layout: EvalsLayout,
  env: NodeJS.ProcessEnv = process.env,
  judgeCwd: string = path.join(layout.root, "quota-cwd"),
): QuotaReader {
  return async (engine) => {
    if (!usesEvalHomes(layout.homes, env)) return null;
    if (engine === EngineId.Codex) {
      const { CodexEngine } = await import("../../src/substrate/engines/codex.ts");
      const codex = new CodexEngine({ engineHome: layout.homes.codex, systemHome: layout.homes.codex });
      return codex.readUsage();
    }
    const { ClaudeCodeEngine } = await import("../../src/substrate/engines/claude-code.ts");
    const claude = new ClaudeCodeEngine({
      engineHome: layout.homes.claude,
      systemHome: layout.homes.claude,
      judgeCwd,
    });
    return claude.readUsage();
  };
}
