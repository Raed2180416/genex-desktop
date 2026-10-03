/**
 * The stage's loader (`live-loader-art.ts`): the halftone plasma in the theme's ink, held still
 * under Reduce Motion, over a shimmering line that says what is on its way.
 */
import { type JSX, useState } from "react";
import { SECOND_MS } from "../../../shared/duration.ts";
import { ArtCanvas, type Draw } from "../../onboarding/ArtCanvas.tsx";
import { drawDots, LOADER_FPS, PLASMA, plasmaDots } from "./live-loader-art.ts";

/** The plasma, flowing from the moment it mounts. */
function LiveLoaderArt(): JSX.Element {
  const [start] = useState(() => performance.now());
  const draw: Draw = (ctx, palette, now) =>
    drawDots(ctx, plasmaDots(now === null ? 0 : (now - start) / SECOND_MS), palette.ink);
  return <ArtCanvas width={PLASMA.width} height={PLASMA.height} draw={draw} fps={LOADER_FPS} />;
}

/** Something on the stage is on its way: it fades in, and out when `leaving`. */
export function StageLoading({ label, leaving = false }: { label: string; leaving?: boolean }): JSX.Element {
  return (
    <div
      className={`flex flex-col items-center gap-2.5 transition-opacity duration-150 animate-in fade-in-0 duration-200 ${leaving ? "opacity-0" : ""}`}
    >
      <LiveLoaderArt />
      <span role="status" data-shimmer className="chat-status-shimmer text-body-sm">
        {label}
      </span>
    </div>
  );
}
