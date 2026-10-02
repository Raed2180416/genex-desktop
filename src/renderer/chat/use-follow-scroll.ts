/**
 * The transcript follows the newest entry while the reader is at the bottom, and stops the moment
 * they scroll up, open a disclosure or press a navigation key; what arrives meanwhile is counted
 * for "Jump to latest". Earlier history loads a few screens before the reader reaches its top.
 */
import type { KeyboardEvent, PointerEvent, RefObject, WheelEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type EarlierHistory, loadsEarlier } from "./transcript-window.ts";

/** Within this many pixels of the bottom, the reader is at the bottom. */
const AT_BOTTOM_PX = 64;

export interface FollowScroll {
  scroller: RefObject<HTMLDivElement | null>;
  /** The reader is at the bottom: the virtual transcript anchors to it. */
  atBottom: RefObject<boolean>;
  /** Entries that arrived while the reader was elsewhere. */
  unseen: number;
  jumpToLatest(): void;
  handlers: {
    onWheel(event: WheelEvent<HTMLDivElement>): void;
    onPointerDown(event: PointerEvent<HTMLDivElement>): void;
    onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
    onScroll(): void;
  };
}

export function useFollowScroll({
  threadId,
  count,
  working,
  loading,
  history,
}: {
  threadId: string | undefined;
  /** How many entries the transcript holds. */
  count: number;
  working: boolean;
  loading: boolean;
  history: EarlierHistory & { loadEarlier: () => Promise<void> };
}): FollowScroll {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const inspectingHistory = useRef(false);
  const lastCount = useRef(0);
  const [unseen, setUnseen] = useState(0);

  const jumpToLatest = (): void => {
    inspectingHistory.current = false;
    atBottom.current = true;
    setUnseen(0);
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new chat starts at its bottom
  useEffect(() => {
    inspectingHistory.current = false;
    atBottom.current = true;
    lastCount.current = 0;
    setUnseen(0);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
  }, [threadId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow on new entries and on busy changes
  useLayoutEffect(() => {
    const added = count - lastCount.current;
    lastCount.current = count;
    if (atBottom.current) {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
      setUnseen(0);
    } else if (added > 0) {
      setUnseen((current) => current + added);
    }
  }, [count, working, loading]);

  const loadAhead = (): void => {
    const element = scroller.current;
    if (!loading && element && loadsEarlier(element, history, atBottom.current)) void history.loadEarlier();
  };
  // After a page lands the loaded top may still be within the reader's reach, or the chat may still
  // be too short to scroll: the next page follows without another scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-checked whenever the loaded history changes
  useEffect(loadAhead, [count, loading, history.hasMore, history.paging, history.pageError]);

  // Rich results, image decoding and streaming may grow without a new entry.
  useEffect(() => {
    const element = scroller.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      // Follow before paint, including decoded media and composer resizing.
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return {
    scroller,
    atBottom,
    unseen,
    jumpToLatest,
    handlers: {
      onWheel: (event) => {
        inspectingHistory.current = false;
        if (event.deltaY < 0) atBottom.current = false;
      },
      onPointerDown: (event) => {
        atBottom.current = false;
        inspectingHistory.current = Boolean((event.target as Element).closest("button[aria-expanded],summary"));
      },
      onKeyDown: (event) => {
        if (["Enter", " "].includes(event.key) && (event.target as Element).closest("button[aria-expanded],summary")) {
          inspectingHistory.current = true;
          atBottom.current = false;
        }
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home"].includes(event.key)) atBottom.current = false;
        if (event.key === "End") {
          inspectingHistory.current = false;
          atBottom.current = true;
        }
      },
      onScroll: () => {
        const element = scroller.current;
        if (!element) return;
        // Following, the scroll is the chat keeping up with its newest line, as often as every
        // frame while something opens: there is nothing to learn from it, and reading the
        // scroller's size here would lay the page out once more each time.
        if (atBottom.current) {
          setUnseen(0);
          return;
        }
        if (
          !inspectingHistory.current &&
          element.scrollHeight - element.scrollTop - element.clientHeight < AT_BOTTOM_PX
        )
          atBottom.current = true;
        if (atBottom.current) setUnseen(0);
        else setUnseen((current) => Math.max(1, current));
        loadAhead();
      },
    },
  };
}
