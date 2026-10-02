/**
 * The Windows and Linux window controls (Electron's `titleBarOverlay`) follow the theme: after
 * each appearance change the renderer sends main the canvas and ink it just applied. macOS draws
 * its own traffic lights, so nothing is sent there.
 */
import { StudioPlatform } from "../shared/boot.ts";
import type { StudioApi, WindowControlColors } from "../shared/studio-api.ts";
import { subscribeAppearance } from "./appearance/store.ts";

/** Only a plain `#rrggbb` crosses to main; anything else waits for the next change. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The overlay's colours from the root's computed theme tokens, or null while they are not plain hex. */
export function windowControlColors(style: Pick<CSSStyleDeclaration, "getPropertyValue">): WindowControlColors | null {
  const color = style.getPropertyValue("--background").trim();
  const symbolColor = style.getPropertyValue("--foreground").trim();
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) return null;
  return { color, symbolColor };
}

/** Send the theme's colours now and after every appearance change, on the platforms that draw an overlay. */
export function syncWindowControls(api: Pick<StudioApi, "setWindowControls">, platform: string): void {
  if (platform === StudioPlatform.Mac) return;
  let last = "";
  const send = (): void => {
    const colors = windowControlColors(getComputedStyle(document.documentElement));
    const key = JSON.stringify(colors);
    if (!colors || key === last) return;
    last = key;
    void api.setWindowControls(colors).catch(() => {});
  };
  send();
  subscribeAppearance(send);
}
