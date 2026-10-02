/** What a region shows when its first load failed: what could not load, why, and Retry. */
import type { JSX } from "react";
import { Button } from "./Button.tsx";

export function LoadFailed({
  what,
  error,
  onRetry,
  retrying = false,
  className = "p-4 text-ink-2",
  detailClassName,
}: {
  /** What could not load, as the sentence names it ("this chat"). */
  what: string;
  error?: string;
  onRetry: () => void;
  /** A Retry is running: the failure stays up and its button waits. */
  retrying?: boolean;
  className?: string;
  detailClassName?: string;
}): JSX.Element {
  return (
    <div role="alert" className={className}>
      Could not load {what}.<p className={detailClassName}>{error}</p>
      <Button onClick={onRetry} disabled={retrying} aria-busy={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
