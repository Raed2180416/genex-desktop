import { Profiler, type ReactNode, type ProfilerOnRenderCallback } from "react";
import {
  type PerformanceComponent,
  PerformanceMarkName,
  type PerformanceMarkName as MarkName,
} from "../shared/performance.ts";

declare const __STUDIO_PERFORMANCE__: boolean;
const enabled = typeof __STUDIO_PERFORMANCE__ !== "undefined" && __STUDIO_PERFORMANCE__;
const counts: Partial<Record<PerformanceComponent, { commits: number; durationMs: number }>> = {};
let firstCommit = false;

declare global {
  interface Window {
    __studioPerformance?: typeof counts;
  }
}
if (enabled) window.__studioPerformance = counts;

/** Fixed-name journey marks are emitted only by an owned diagnostics build. */
export function markPerformance(name: MarkName): void {
  if (!enabled) return;
  void window.studio.performanceMark({ name, at: performance.now() }).catch(() => {});
}

const committed: ProfilerOnRenderCallback = (id, _phase, duration) => {
  const component = id as PerformanceComponent;
  const entry = counts[component] ?? { commits: 0, durationMs: 0 };
  entry.commits++;
  entry.durationMs += duration;
  counts[component] = entry;
  if (!firstCommit) {
    firstCommit = true;
    markPerformance(PerformanceMarkName.FirstCommit);
  }
};

/** Zero instrumentation in ordinary builds; fixture snapshots expose bounded commit totals. */
export function PerformanceBoundary({ id, children }: { id: PerformanceComponent; children: ReactNode }) {
  return enabled ? (
    <Profiler id={id} onRender={committed}>
      {children}
    </Profiler>
  ) : (
    children
  );
}
