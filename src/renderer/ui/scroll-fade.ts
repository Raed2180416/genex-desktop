/**
 * A scrolling region whose last visible line fades while more of it lies below, as folded content
 * does (theme.css `.scroll-fade`). At the end of the scroll the fade goes, so the last line reads.
 */
import { type RefCallback, useCallback } from "react";

/** How far short of the end still counts as the end: scroll positions come in fractions of a pixel. */
const END_SLACK_PX = 1;

/** Is there more of this region below what it shows? */
function moreBelow(element: HTMLElement): boolean {
  return element.scrollTop + element.clientHeight < element.scrollHeight - END_SLACK_PX;
}

/**
 * Put the returned ref on the scrolling region (class `scroll-fade`): it keeps the region's
 * `data-more` as it scrolls and resizes. The attribute is set directly, so scrolling never renders.
 */
export function useMoreBelow<T extends HTMLElement>(): RefCallback<T> {
  return useCallback((element: T | null) => {
    if (!element) return;
    const measure = () => element.toggleAttribute("data-more", moreBelow(element));
    // The region's own size and its content's: either can bring the end into view.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, []);
}
