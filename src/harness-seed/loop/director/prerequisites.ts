import { HostMethod } from "../host-methods.ts";
import { GoalBlocker, GoalStatus, goalDecision } from "./goals.ts";
import type { Night } from "./night.ts";

/** Resolve online prerequisites before allocating a worker; other required goals may still proceed. */
export async function requireMultiplayer(night: Night, goalId: string): Promise<string | null> {
  const ledger = night.state.goals;
  const goal = ledger?.entries.find((entry) => entry.id === goalId);
  if (!goal?.multiplayer || !ledger) return null;
  const result = await night.ctx.call(HostMethod.PluginsPreflightMultiplayer, {
    project: night.run.project,
    threadId: night.threadId,
  });
  if (result.ready) return null;
  goal.status = GoalStatus.Blocked;
  goal.blocker = GoalBlocker.Hosted;
  await night.saveJournal();
  await night.decision(result.reason, result.reason);
  if (goalDecision(ledger, night.state.integrationHead) === GoalStatus.Blocked)
    await night.finish({ summary: result.reason, land: "no", victory: "no" });
  return result.reason;
}
