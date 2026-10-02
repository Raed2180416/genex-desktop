import { useEffect, useState } from "react";
import type { RunSummary } from "../shared/run-summary.ts";
export function useRunSummary(project: string | null, runId: string | null): RunSummary | null {
  const [summary, setSummary] = useState<RunSummary | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!window.studio.onRunSummary) return;
    if (!project || !runId) return;
    return window.studio.onRunSummary(project, runId, (next) =>
      setSummary((current) => {
        const sameRevision = current?.revision !== undefined && current.revision === next.revision;
        const samePreview = JSON.stringify(current?.preview) === JSON.stringify(next.preview);
        return sameRevision && samePreview ? current : next;
      }),
    );
  }, [project, runId]);
  return summary?.project === project && summary.runId === runId ? summary : null;
}
