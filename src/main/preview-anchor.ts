/**
 * Where Live's native view belongs while the studio window changes size. The renderer measures the
 * stage's slot a frame after the window moved; until its next report arrives, main keeps the
 * slot's right and bottom margins, as the chat column holds its width and the stage takes the
 * rest. The view then moves in the same frame as the window, as a browser page does.
 */

type Size = { width: number; height: number };
type Rectangle = Size & { x: number; y: number };

/** The slot measured in a `viewport`-sized window, carried into a window of `content` size. */
export function anchoredBounds(reported: Rectangle, viewport: Size | null, content: Size | null): Rectangle {
  const hidden = reported.width <= 0 || reported.height <= 0;
  if (hidden || !viewport || !content) return reported;
  return {
    x: reported.x,
    y: reported.y,
    width: Math.max(0, reported.width + content.width - viewport.width),
    height: Math.max(0, reported.height + content.height - viewport.height),
  };
}
