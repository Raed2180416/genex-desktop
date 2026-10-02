/**
 * Timers a component keeps while it is on screen: a poll that repeats a read, and a clock that
 * keeps an elapsed time current in its own text.
 */
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/** Run `poll` every `everyMs` while `enabled`; the newest `poll` is the one that runs. */
export function usePolling(poll: () => void, everyMs: number, enabled = true): void {
  const latest = useRef(poll);
  latest.current = poll;
  useEffect(() => {
    if (!enabled) return;
    let hidden = document.hidden;
    const timer = setInterval(() => {
      if (!document.hidden) latest.current();
    }, everyMs);
    const visibility = () => {
      const wasHidden = hidden;
      hidden = document.hidden;
      if (wasHidden && !hidden) latest.current();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [everyMs, enabled]);
}

/**
 * A clock's text, rewritten every `everyMs` while the window is visible straight into the node the
 * returned ref is on, so a tick never re-renders (or commits) the tree around it. Give that node no
 * children; every render also brings its text up to date with the newest `words`.
 */
export function useClockText<T extends HTMLElement>(
  words: (now: number) => string,
  everyMs: number,
): RefObject<T | null> {
  const node = useRef<T>(null);
  const latest = useRef(words);
  latest.current = words;
  useLayoutEffect(() => writeClock(node.current, words));
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) writeClock(node.current, latest.current);
    }, everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return node;
}

function writeClock(node: HTMLElement | null, words: (now: number) => string): void {
  const text = words(Date.now());
  if (node && node.textContent !== text) node.textContent = text;
}
