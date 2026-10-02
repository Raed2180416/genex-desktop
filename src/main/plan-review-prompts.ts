/** What the lead is sent around a plan review (`plan-review.ts`): a revision request, and the approved plan. */
import { APPROVED_PLAN_HEADING } from "../shared/composer.ts";

/** A new request on an open review: the original ask, then the revision the user asked for. */
export function planRevisionRequest(original: string, revision: string): string {
  return `${original}\n\nRequested revision:\n${revision}`;
}

/** The message that starts the work once the user approved the plan. */
export function approvedPlanMessage(request: string, plan: string): string {
  return `${request}${APPROVED_PLAN_HEADING}${plan}\n\nProceed with this plan.`;
}
