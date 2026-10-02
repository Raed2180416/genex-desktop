/**
 * Keeps the colour tweaker usable over an open dialog, menu or popover.
 *
 * A modal Radix dialog turns off pointer events on the body, traps focus, dismisses itself on a
 * press or focus outside, and blocks wheel scrolling outside it; each hears those through a
 * listener on the document. The panel turns its own pointer events back on (tweaker-style.ts) and
 * stops its events at the body, after React (whose portal listener there came first) has handled
 * them, so the document never hears them.
 *
 * A Base UI popover closes when focus leaves it, heard on the popover itself, so focus moving into
 * the panel is stopped at the window before it reaches the popover. A press on the panel does not
 * close it: the panel is an `aria-live` region, which Base UI never marks as outside.
 */
import { type RefObject, useEffect } from "react";

/** The events a dialog, menu or scroll lock hears on the document. */
const ISOLATED_EVENTS = ["pointerdown", "mousedown", "click", "focusin", "focusout", "wheel", "touchmove"] as const;

/** Stop every event that starts in the panel at the body, and focus leaving for the panel at the window. */
export function useIsolation(panel: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const body = document.body;
    const within = (node: EventTarget | null): boolean =>
      node instanceof Node && Boolean(panel.current?.contains(node));
    const stopFromPanel = (event: Event): void => {
      const related = event instanceof FocusEvent ? event.relatedTarget : null;
      if (within(event.target) || within(related)) event.stopPropagation();
    };
    const stopFocusLeavingForPanel = (event: FocusEvent): void => {
      if (!within(event.target) && within(event.relatedTarget)) event.stopPropagation();
    };
    for (const type of ISOLATED_EVENTS) body.addEventListener(type, stopFromPanel);
    window.addEventListener("focusout", stopFocusLeavingForPanel, true);
    return () => {
      for (const type of ISOLATED_EVENTS) body.removeEventListener(type, stopFromPanel);
      window.removeEventListener("focusout", stopFocusLeavingForPanel, true);
    };
  }, [panel]);
}
