import { SECOND_MS } from "../shared/duration.ts";
import type { ModelPullProgress } from "../shared/ui-events.ts";

const MODEL_PROGRESS_INTERVAL_MS = SECOND_MS / 10;

/** Trailing progress updates retain the latest value and flush before completion or failure. */
export function modelProgress(
  send: (value: ModelPullProgress) => void,
  schedule: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
) {
  let latest: ModelPullProgress | undefined;
  let cancel: (() => void) | undefined;
  const flush = () => {
    cancel?.();
    cancel = undefined;
    if (!latest) return;
    const value = latest;
    latest = undefined;
    send(value);
  };
  return {
    update(value: ModelPullProgress) {
      latest = value;
      cancel ??= schedule(flush, MODEL_PROGRESS_INTERVAL_MS);
    },
    flush,
  };
}
