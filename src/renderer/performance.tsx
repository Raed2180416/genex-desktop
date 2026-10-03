import { Profiler, type ReactNode, type ProfilerOnRenderCallback, useLayoutEffect } from "react";
import {
  type PerformanceComponent,
  PerformanceMarkName,
  type PerformanceMarkName as MarkName,
} from "../shared/performance.ts";

declare const __STUDIO_PERFORMANCE__: boolean;
declare const __STUDIO_COMMIT_COUNTS__: boolean;
const enabled = typeof __STUDIO_PERFORMANCE__ !== "undefined" && __STUDIO_PERFORMANCE__;
/** Profilers wrap the app only where checks read commit counts (`scripts/renderer-build.mjs`). */
const counting = typeof __STUDIO_COMMIT_COUNTS__ !== "undefined" && __STUDIO_COMMIT_COUNTS__;
const counts: Partial<Record<PerformanceComponent, { commits: number; durationMs: number }>> = {};
let firstCommit = false;

declare global {
  interface Window {
    __studioPerformance?: typeof counts;
  }
}
if (counting) window.__studioPerformance = counts;

/** Fixed-name journey marks are emitted only by an owned diagnostics build. */
export function markPerformance(name: MarkName): void {
  if (!enabled) return;
  void window.studio.performanceMark({ name, at: performance.now() }).catch(() => {});
}

function markFirstCommit(): void {
  if (firstCommit) return;
  firstCommit = true;
  markPerformance(PerformanceMarkName.FirstCommit);
}

const committed: ProfilerOnRenderCallback = (id, _phase, duration) => {
  const component = id as PerformanceComponent;
  const entry = counts[component] ?? { commits: 0, durationMs: 0 };
  entry.commits++;
  entry.durationMs += duration;
  counts[component] = entry;
  markFirstCommit();
};

/** Marks the first commit where no Profiler reports it. */
function FirstCommit({ children }: { children: ReactNode }) {
  useLayoutEffect(markFirstCommit, []);
  return children;
}

/**
 * Zero instrumentation in ordinary builds; owned builds mark the first commit, and fixture
 * builds also count commits, which snapshots expose as bounded totals.
 */
export function PerformanceBoundary({ id, children }: { id: PerformanceComponent; children: ReactNode }) {
  if (counting)
    return (
      <Profiler id={id} onRender={committed}>
        {children}
      </Profiler>
    );
  return enabled ? <FirstCommit>{children}</FirstCommit> : children;
}
