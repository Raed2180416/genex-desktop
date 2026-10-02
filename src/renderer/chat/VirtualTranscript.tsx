import { appendedEntryIds } from "./transcript-motion.ts";
import {
  anchorShift,
  INITIAL_VIEWPORT,
  mountedRange,
  retainedViewport,
  rowOffsets,
  type TranscriptLayout,
} from "./transcript-window.ts";
import {
  type AnimationEvent,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { prefersReducedMotion } from "../ui/media-queries.ts";
import { OPEN_MS } from "../ui/motion.ts";

/** How much longer than its opening a row may take before it counts as open anyway (it never ran). */
const OPEN_SLACK_MS = 200;
/** The row opening's own animation (theme.css), whose end means the row is open. */
const ROW_OPENING = "chat-row-open";

/**
 * Variable-height window. Only the viewport and a small reading buffer mount rich replies.
 * `entrance` says how a row that mounts arrives: how far into its opening it starts (0 for a new
 * row, more for one taking over a placeholder mid-opening), or null when it is simply there.
 * `appended` says it arrived after the rows before it (history and earlier pages never are).
 * While `still` (the chat is loading) nothing has been seen, so what is there once it loads is
 * history too.
 */
export function VirtualTranscript<T extends { id: string }>({
  items,
  scroller,
  follow,
  renderItem,
  entrance,
  still = false,
}: {
  items: T[];
  scroller: RefObject<HTMLDivElement | null>;
  follow: RefObject<boolean>;
  renderItem: (item: T) => ReactNode;
  entrance?: (item: T, appended: boolean) => number | null;
  still?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const previousIds = useRef<string[] | null>(null);
  const ids = items.map((item) => item.id);
  const entering = appendedEntryIds(previousIds.current, ids);
  useLayoutEffect(() => {
    previousIds.current = still ? null : ids;
  });
  const heights = useRef(new Map<string, number>());
  const [revision, resize] = useState(0);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const oldPositions = useRef<TranscriptLayout | null>(null);
  const viewportRef = useRef(viewport);
  const offsets = useMemo(() => rowOffsets(items, heights.current), [items, revision]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = host.current
        ? host.current.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
        : 0;
      const next = { top: Math.max(0, element.scrollTop - top), height: element.clientHeight };
      viewportRef.current = next;
      setViewport((previous) => retainedViewport(offsetsRef.current, previous, next));
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scroll);
    observer.observe(element);
    element.addEventListener("scroll", scroll, { passive: true });
    measure();
    return () => {
      element.removeEventListener("scroll", scroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroller]);
  useLayoutEffect(() => {
    // Following the bottom keeps its own place; otherwise the row that was on top stays there.
    const previous = follow.current ? null : oldPositions.current;
    const element = scroller.current;
    const layout = { ids: items.map((item) => item.id), offsets };
    if (previous && element) {
      const delta = anchorShift(previous, layout, viewportRef.current.top);
      if (delta) element.scrollTop += delta;
    }
    oldPositions.current = layout;
  }, [offsets]);
  useHostAnchor(host, scroller, follow);
  const enterFrom = (item: T): number | null => {
    const appended = entering.has(item.id);
    if (entrance) return entrance(item, appended);
    return appended ? 0 : null;
  };
  const { start, end } = mountedRange(offsets, viewport);
  return (
    <div
      ref={host}
      data-chat-transcript
      data-total-entries={items.length}
      data-mounted-entries={end - start}
      className="min-w-0"
      style={{ overflowAnchor: "none" }}
    >
      <div aria-hidden style={{ height: offsets[start] }} />
      {items.slice(start, end).map((item) => (
        <MeasuredRow
          key={item.id}
          id={item.id}
          enterFrom={enterFrom(item)}
          onMeasure={(height) => {
            if (Math.abs((heights.current.get(item.id) ?? 0) - height) < 1) return;
            heights.current.set(item.id, height);
            resize((value) => value + 1);
          }}
        >
          {renderItem(item)}
        </MeasuredRow>
      ))}
      <div aria-hidden style={{ height: (offsets.at(-1) ?? 0) - (offsets[end] ?? 0) }} />
    </div>
  );
}

/**
 * Keeps the rows in place when something above the transcript appears or goes, such as Studio's
 * intro once the chat's first page has loaded: the scroll moves with the transcript's top.
 */
function useHostAnchor(
  host: RefObject<HTMLDivElement | null>,
  scroller: RefObject<HTMLDivElement | null>,
  follow: RefObject<boolean>,
): void {
  const hostTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !host.current) return;
    const top = host.current.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
    const moved = hostTop.current === null ? 0 : top - hostTop.current;
    hostTop.current = top;
    if (moved && !follow.current) element.scrollTop += moved;
  });
}

/**
 * One row, measured for the window. A row that arrives opens in place (theme.css
 * `.chat-entry-arriving`); while it opens its height is the opening's, so it is measured once open.
 */
function MeasuredRow({
  id,
  onMeasure,
  children,
  enterFrom,
}: {
  id: string;
  /** How far into its opening the row starts (ms), or null when it is simply there. */
  enterFrom: number | null;
  onMeasure: (height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Fixed at mount: changing a running opening's delay would jump it.
  const [entered] = useState(enterFrom);
  const [arriving, setArriving] = useState(() => enterFrom !== null && !prefersReducedMotion());
  const opening = useRef(arriving);
  opening.current = arriving;
  const measure = useRef(onMeasure);
  measure.current = onMeasure;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => {
      if (!opening.current) measure.current(element.getBoundingClientRect().height);
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (arriving) {
      const timer = setTimeout(() => setArriving(false), OPEN_MS + OPEN_SLACK_MS);
      return () => clearTimeout(timer);
    }
    // Open now: a row that opened is measured once, at its own height.
    if (entered !== null && ref.current) measure.current(ref.current.getBoundingClientRect().height);
  }, [arriving, entered]);
  return (
    <div
      ref={ref}
      data-chat-entry={id}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && event.animationName === ROW_OPENING) setArriving(false);
      }}
      className={`flow-root min-w-0 pb-4 ${arriving ? "chat-entry-arriving" : ""}`}
      style={arriving && entered ? ({ "--entered": `${entered}ms` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
