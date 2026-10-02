/**
 * The tweaker panel's place in the window: dragged by its header, kept inside the window as it
 * resizes, and remembered where it was dropped. A drag moves the element directly and commits
 * once, on release, so the rows beneath do not re-render on every pointer move.
 */
import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from "react";

/** The panel's width, as its stylesheet sets it. */
export const PANEL_WIDTH = 320;
/** The gap the panel keeps from the window's edges. */
const EDGE = 8;
/** Where the panel first opens: below the title bar, at the right. */
const DEFAULT_TOP = 52;
const DEFAULT_RIGHT = 16;
/** The least of the panel that stays in the window: its header. */
const HEADER_HEIGHT = 36;
/** The shortest the panel's body gets before it scrolls. */
const MIN_HEIGHT = 160;
/** A press on these starts no drag. */
const NOT_A_HANDLE = "button, select, input, label, output";

type Point = { x: number; y: number };

/** `at` kept inside a window of `size`. */
function inside(at: Point, size: { width: number; height: number }): Point {
  return {
    x: Math.min(Math.max(EDGE, at.x), Math.max(EDGE, size.width - PANEL_WIDTH - EDGE)),
    y: Math.min(Math.max(EDGE, at.y), Math.max(EDGE, size.height - HEADER_HEIGHT - EDGE)),
  };
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** Where the panel sits, how tall it may be, and the header's pointer-down that drags it. */
export function usePanelDrag(
  panel: RefObject<HTMLElement | null>,
  remembered: { x: number | null; y: number | null },
  onDrop: (x: number, y: number) => void,
) {
  const size = useWindowSize();
  const [dragging, setDragging] = useState(false);
  const grab = useRef<Point | null>(null);
  const fallback = { x: size.width - PANEL_WIDTH - DEFAULT_RIGHT, y: DEFAULT_TOP };
  const at = inside({ x: remembered.x ?? fallback.x, y: remembered.y ?? fallback.y }, size);

  const start = (event: ReactPointerEvent<HTMLElement>): void => {
    const element = panel.current;
    if (!element || event.button !== 0 || (event.target as Element).closest(NOT_A_HANDLE)) return;
    grab.current = { x: event.clientX - at.x, y: event.clientY - at.y };
    let last = at;
    const move = (e: PointerEvent): void => {
      if (!grab.current) return;
      last = inside({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }, size);
      element.style.left = `${last.x}px`;
      element.style.top = `${last.y}px`;
    };
    const end = (): void => {
      grab.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      onDrop(last.x, last.y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    setDragging(true);
    event.preventDefault();
  };

  return { at, maxHeight: Math.max(MIN_HEIGHT, size.height - at.y - EDGE), dragging, start };
}
