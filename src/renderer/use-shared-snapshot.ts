import { useMemo, useRef } from "react";
import { shareSnapshot } from "./state/snapshot-equality.ts";

/** Preserve immutable nested branches across rebuilt plain snapshots; never share host objects. */
export function useSharedSnapshot<T>(incoming: T): T {
  const previous = useRef(incoming);
  return useMemo(() => {
    const shared = shareSnapshot(previous.current, incoming);
    previous.current = shared;
    return shared;
  }, [incoming]);
}
