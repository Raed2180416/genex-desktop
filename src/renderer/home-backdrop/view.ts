/**
 * What a background canvas draws. Home's background is the window's: the picture is cut to cover the
 * whole window and home shows its own part of it, so the sidebar opening or closing beside home
 * changes nothing drawn. A preview draws the same, seen through home's part.
 */

/** Pixels per point at most: past 2 the marks look the same and cost more. */
const MAX_DENSITY = 2;

/** A size in points. */
export interface Size {
  width: number;
  height: number;
}

/** A rectangle in points. */
export interface Rect extends Size {
  x: number;
  y: number;
}

/** The frame the picture is cut to cover, the part of it the canvas holds, and the canvas's pixels per point. */
export interface BackdropView {
  frame: Size;
  view: Rect;
  scale: number;
}

/** Home's drawing: the whole window at the screen's density. */
export function homeView(window: Size, density: number): BackdropView {
  return {
    frame: window,
    view: { x: 0, y: 0, width: window.width, height: window.height },
    scale: Math.min(density, MAX_DENSITY),
  };
}

/** A preview of home: the window's drawing through home's part of it, shrunk to the preview's width. */
export function previewView(window: Size, home: Rect, previewWidth: number, density: number): BackdropView {
  return { frame: window, view: home, scale: (Math.min(density, MAX_DENSITY) * previewWidth) / home.width };
}
