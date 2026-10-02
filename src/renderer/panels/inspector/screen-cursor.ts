/** Where an agent's cursor falls on a picture of its screen that is cropped to fill a node. */
import type { AgentScreenFrame } from "../../../shared/agent-screen.ts";

/**
 * The cursor's place, in % of a `box` that the frame covers (`object-fit: cover`): the frame is
 * scaled to fill the box and centred, so an edge of it may be cropped away.
 */
export function coverCursor(
  frame: Pick<AgentScreenFrame, "width" | "height" | "cursor">,
  box: { w: number; h: number },
): { left: number; top: number } {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const scale = Math.max(box.w / width, box.h / height);
  const left = (box.w - width * scale) / 2 + frame.cursor.x * scale;
  const top = (box.h - height * scale) / 2 + frame.cursor.y * scale;
  return { left: (left / Math.max(1, box.w)) * 100, top: (top / Math.max(1, box.h)) * 100 };
}
