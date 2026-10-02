/**
 * Effects whose async work can outlive the render that started it. Each run gets an `alive()`
 * check: an answer that lands after the component moved on (new deps, or unmounted) is dropped
 * instead of written over the newer state.
 */
import { type DependencyList, useEffect } from "react";

/** What an async effect gets: whether this run still counts. It may return its own cleanup. */
export type AsyncEffect = (alive: () => boolean) => undefined | (() => void);

/** `useEffect` with a liveness check the effect's promises read before they set state. */
export function useAsyncEffect(effect: AsyncEffect, deps: DependencyList): void {
  useEffect(() => {
    let live = true;
    const cleanup = effect(() => live);
    return () => {
      live = false;
      cleanup?.();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps decide when the effect reruns, as with useEffect.
  }, deps);
}
