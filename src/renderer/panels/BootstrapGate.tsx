/**
 * What an area of the shell shows until the bootstrap is ready. The first one runs under the
 * window's startup loader (`app-loader.ts`), so the area draws nothing; a failed one shows the
 * area's own failure with main's reason and a Retry that bootstraps again, and keeps it up, its
 * Retry busy, while that retry runs. Each area says it in its own words (the sidebar, the chat and
 * the stage fail differently), so each area has its own gate.
 */
import type { JSX, ReactNode } from "react";
import { useSession } from "../state/hooks.ts";
import { SessionStatus } from "../state/session.ts";
import { studio } from "../state/studio.ts";

/** A failed bootstrap: main's reason, and Retry with whether one is running. */
export interface BootstrapFailure {
  error: string | null;
  retry: () => void;
  retrying: boolean;
}

export function BootstrapGate({
  failed,
  children,
}: {
  failed: (failure: BootstrapFailure) => ReactNode;
  children: ReactNode;
}): JSX.Element | null {
  const status = useSession((s) => s.status);
  const error = useSession((s) => s.error);
  if (status === SessionStatus.Ready) return <>{children}</>;
  // A retry starts from a failure, whose error stays until a bootstrap succeeds.
  const retrying = status === SessionStatus.Loading;
  if (status === SessionStatus.Failed || error !== null)
    return <>{failed({ error, retry: () => void studio().bootstrap(), retrying })}</>;
  return null;
}
