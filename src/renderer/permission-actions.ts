/**
 * Settings → Permissions shows what is always allowed by action, not by game: one row per saved
 * rule, with every game that holds it, so thirty games that allow `npm install` are one row.
 */
import type { PermissionRuleView } from "../shared/permissions.ts";

/** One action allowed without asking, and the games that allow it. */
export interface AllowedAction {
  rule: string;
  games: Array<{ project: string; title: string }>;
}

/** Each saved rule once, with its games in the order the host lists them; the most shared first. */
export function allowedActions(views: readonly PermissionRuleView[]): AllowedAction[] {
  const byRule = new Map<string, AllowedAction>();
  for (const view of views)
    for (const rule of view.rules) {
      const action = byRule.get(rule) ?? { rule, games: [] };
      action.games.push({ project: view.project, title: view.title || view.project });
      byRule.set(rule, action);
    }
  // A stable sort keeps the host's order among actions held by as many games.
  return [...byRule.values()].sort((a, b) => b.games.length - a.games.length);
}
