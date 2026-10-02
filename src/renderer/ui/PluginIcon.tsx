/** A plugin's or MCP server's own picture, like an app's in the Dock, with its initial as the fallback. */
import type { JSX } from "react";
import { useState } from "react";

/** How big a plugin's or server's picture is drawn: a list row, a page header or a menu line. */
export type PluginIconSize = "row" | "large" | "menu";

/** The first letter of a name, for a picture that has none. */
export const initialOf = (name: string): string => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";

/**
 * A plugin's or MCP server's own picture, like an app's in the Dock; its initial on a quiet tile
 * when it ships none or the picture can't be read.
 */
export function PluginIcon({
  name,
  src,
  size = "row",
}: {
  name: string;
  src?: string | undefined;
  size?: PluginIconSize;
}): JSX.Element {
  const [broken, setBroken] = useState<string | null>(null);
  const className = `extension-icon extension-icon-${size}`;
  if (src && broken !== src)
    return <img className={className} src={src} alt="" draggable={false} onError={() => setBroken(src)} />;
  return (
    <span className={`${className} extension-icon-letter`} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}
