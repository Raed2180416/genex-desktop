import { useEffect, useMemo, useRef } from "react";
import { coverEdge } from "../../shared/cover-recipe.ts";
import { coverSignature, displayCover, type GameCover } from "../../shared/game-library.ts";
import { gameCoverUrl } from "../../shared/game-cover.ts";
import { animateCover, type CoverHandle } from "./cover-animation.ts";

/**
 * A game's cover sphere. `gameKey` (the game's name) gives a game without a saved look its own
 * one and keeps its sphere's clock when the row remounts. The still image underneath shows until
 * the sphere paints, and stays when there is no GPU.
 */
export function GameAvatar({
  cover,
  active = false,
  gameKey,
  className = "",
}: {
  cover?: GameCover;
  active?: boolean;
  gameKey?: string;
  className?: string;
}) {
  const src = useMemo(() => gameCoverUrl(cover, gameKey), [cover, gameKey]);
  const shown = useMemo(() => displayCover(cover, gameKey), [cover, gameKey]);
  const signature = shown ? coverSignature(shown) : "";
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<CoverHandle | null>(null);
  const activeNow = useRef(active);
  activeNow.current = active;
  useEffect(() => {
    if (!shown || !canvas.current) return;
    const registered = animateCover(canvas.current, shown, gameKey, activeNow.current);
    handle.current = registered;
    return () => {
      registered.dispose();
      handle.current = null;
    };
  }, [signature, gameKey]); // The signature names everything the sphere draws.
  useEffect(() => {
    handle.current?.active(active);
  }, [active]);
  if (!shown) return <img src={src} alt="" aria-hidden draggable={false} className={`game-avatar ${className}`} />;
  return (
    <span
      className={`game-avatar game-avatar-shader ${shown.kind === "shader" && shown.version === 2 ? "game-cover-lens" : ""} ${className}`}
      data-edge={coverEdge(shown)}
      aria-hidden
    >
      <img src={src} alt="" draggable={false} />
      <canvas ref={canvas} className="game-cover-canvas" />
    </span>
  );
}
