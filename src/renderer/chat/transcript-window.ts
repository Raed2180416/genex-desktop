/**
 * The transcript's variable-height window, as arithmetic: where each row starts, which rows are
 * mounted around the viewport, how far the scroll must move to keep the top row in place when
 * rows above it change height, and when earlier history loads ahead of the reader.
 */

/** A row's height before it has been measured, in pixels. */
export const ESTIMATED_ROW_PX = 100;
/** How far above and below the viewport rows stay mounted, in pixels. */
export const OVERSCAN_PX = 700;
/** The viewport assumed until the scroller has been measured, in pixels. */
export const INITIAL_VIEWPORT: TranscriptViewport = { top: 0, height: 900 };
/** Within this many screens of the loaded top, the next page of earlier history loads. */
export const LOAD_AHEAD_SCREENS = 3;

/** The visible part of the transcript, in its own coordinates. */
export interface TranscriptViewport {
  top: number;
  height: number;
}

/** A laid-out transcript: its row ids and where each starts, the total height last. */
export interface TranscriptLayout {
  ids: readonly string[];
  offsets: readonly number[];
}

/** Each row's top, then the total height: a measured row counts its height, others `ESTIMATED_ROW_PX`. */
export function rowOffsets(items: readonly { id: string }[], heights: ReadonlyMap<string, number>): number[] {
  const offsets = [0];
  let top = 0;
  for (const item of items) {
    top += heights.get(item.id) ?? ESTIMATED_ROW_PX;
    offsets.push(top);
  }
  return offsets;
}

/** The rows to mount, from `start` up to but not including `end`: every row within `OVERSCAN_PX` of the viewport. */
export function mountedRange(offsets: readonly number[], viewport: TranscriptViewport): { start: number; end: number } {
  const count = offsets.length - 1;
  const top = (index: number): number => offsets[index] ?? 0;
  let start = 0;
  while (start < count && top(start + 1) < viewport.top - OVERSCAN_PX) start++;
  let end = start;
  while (end < count && top(end) < viewport.top + viewport.height + OVERSCAN_PX) end++;
  return { start, end };
}

/**
 * How far the row that was at the top of the viewport moved in the new layout: the scroll adds
 * this so the row stays put. Zero when that row is gone.
 */
export function anchorShift(previous: TranscriptLayout, next: TranscriptLayout, viewportTop: number): number {
  const reachesViewport = (index: number): boolean =>
    index < previous.ids.length && (previous.offsets[index + 1] ?? 0) > viewportTop;
  const index = Math.max(
    0,
    previous.offsets.findIndex((_offset, i) => reachesViewport(i)),
  );
  const id = previous.ids[index];
  if (id === undefined) return 0;
  const moved = next.ids.indexOf(id);
  if (moved < 0) return 0;
  return (next.offsets[moved] ?? 0) - (previous.offsets[index] ?? 0);
}

/** Keep React state when scrolling does not mount or unmount a transcript row. */
export function retainedViewport(
  offsets: readonly number[],
  previous: TranscriptViewport,
  next: TranscriptViewport,
): TranscriptViewport {
  const before = mountedRange(offsets, previous);
  const after = mountedRange(offsets, next);
  return before.start === after.start && before.end === after.end ? previous : next;
}

/** The scroller's position: how far it is scrolled from the top, how tall a screen is, and the whole. */
export interface ScrollPosition {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** What the chat knows about its earlier history. */
export interface EarlierHistory {
  hasMore: boolean;
  paging: boolean;
  pageError?: string;
}

/**
 * Whether the next page of earlier history should load now: a reader who has left the bottom is
 * within a few screens of the loaded top, so it lands before they reach it. A chat following its
 * bottom reads its newest page and no more, unless it is too short to scroll at all. One page at
 * a time; a failed page waits for the reader's Try again rather than retrying on every scroll.
 */
export function loadsEarlier(position: ScrollPosition, history: EarlierHistory, following: boolean): boolean {
  if (!history.hasMore || history.paging || history.pageError) return false;
  if (position.scrollHeight <= position.clientHeight) return true;
  return !following && position.scrollTop < position.clientHeight * LOAD_AHEAD_SCREENS;
}
