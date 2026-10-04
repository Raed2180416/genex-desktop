/**
 * The status line's loader: the Live tab's halftone plasma as a 14px orb (`STATUS_PLASMA`), in the
 * theme's ink, held still under Reduce Motion.
 */
import { type JSX, useState } from "react";
import { SECOND_MS } from "../../shared/duration.ts";
import { ArtCanvas, type Draw } from "../onboarding/ArtCanvas.tsx";
import { drawDots, LOADER_FPS, plasmaDots, STATUS_PLASMA } from "../panels/stage/live-loader-art.ts";

/** The plasma orb, flowing from the moment it mounts. */
export function StatusOrb(): JSX.Element {
  const [start] = useState(() => performance.now());
  const draw: Draw = (ctx, palette, now) =>
    drawDots(ctx, plasmaDots(now === null ? 0 : (now - start) / SECOND_MS, STATUS_PLASMA), palette.ink);
  return (
    <ArtCanvas
      width={STATUS_PLASMA.width}
      height={STATUS_PLASMA.height}
      draw={draw}
      fps={LOADER_FPS}
      className="chat-status-orb"
    />
  );
}
