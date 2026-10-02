import { Composition } from "remotion";
import { GenexPromo } from "./GenexPromo";
import { FPS, FRAMES, H, W } from "./theme";

export function RemotionRoot() {
  return <Composition id="GenexPromo" component={GenexPromo} durationInFrames={FRAMES} fps={FPS} width={W} height={H} />;
}
