/**
 * The plan a chat is reviewing: the newest `plan_review` in its log, whether it waits for the
 * user, and the answer and "change the plan" steps the composer's plan card takes.
 */
import { useMemo, useState } from "react";
import { PlanReviewState, type PlanReviewRecord } from "../../shared/composer.ts";
import type { EventEnvelope } from "../../shared/event-log.ts";
import { CHAT_WORDS } from "../words.ts";
import { pendingPlanReview } from "./transcript.ts";

/** Does the plan wait for the user: shown for approval, or failed and offered again? */
export const planAwaitsAnswer = (review: PlanReviewRecord | null): review is PlanReviewRecord =>
  review?.state === PlanReviewState.Waiting || review?.state === PlanReviewState.Failed;

/** Is the plan being written, or its approved build starting? */
export const planInProgress = (review: PlanReviewRecord | null): boolean =>
  review?.state === PlanReviewState.Generating || review?.state === PlanReviewState.Starting;

export interface PlanReviewView {
  /** The newest plan review in the chat, whatever its state. */
  review: PlanReviewRecord | null;
  /** The user asked to change the waiting plan and is writing the change. */
  revising: boolean;
  /** The plan is being written, or its build starting. */
  working: boolean;
  /** An answer is on its way to main. */
  answering: boolean;
  /** Approve or reject the waiting plan; refuses a plan that no longer waits. */
  answer(approved: boolean): Promise<void>;
  /** The user chose to change the waiting plan. */
  startRevising(): void;
}

export function usePlanReview(threadEvents: readonly EventEnvelope[], threadId: string | undefined): PlanReviewView {
  const [answering, setAnswering] = useState(false);
  const [revisingPlanId, setRevisingPlanId] = useState<string | null>(null);
  const review = useMemo(() => pendingPlanReview(threadEvents), [threadEvents]);
  const answer = async (approved: boolean): Promise<void> => {
    if (answering) return;
    if (!threadId || !review) return;
    setAnswering(true);
    try {
      if (!(await window.studio.answerPlan(threadId, review.id, approved))) throw new Error(CHAT_WORDS.planSettled);
    } finally {
      setAnswering(false);
    }
  };
  return {
    review,
    revising: revisingPlanId === review?.id && planAwaitsAnswer(review),
    working: planInProgress(review),
    answering,
    answer,
    startRevising: () => {
      if (review) setRevisingPlanId(review.id);
    },
  };
}
