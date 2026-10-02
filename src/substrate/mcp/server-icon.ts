/**
 * An MCP server's own picture, from its `initialize` answer (`serverInfo.icons`, MCP 2025-11-25):
 * the one to show, and its bytes as a `data:` URL the renderer can draw. The renderer never loads
 * a server's URL itself: an https icon is fetched here once, capped and checked to be the picture
 * it says, and anything else is left out (the page then shows the server's initial).
 */
import { SECOND_MS } from "../../shared/duration.ts";
import { pictureType } from "../image-sniff.ts";

/** The largest picture Studio keeps for a server; one drawn at 44 points needs a fraction of it. */
export const SERVER_ICON_MAX_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 10 * SECOND_MS;
const DATA_URL = /^data:([a-z0-9.+/-]+)(;[a-z0-9=.+-]+)*?(;base64)?,(.*)$/is;

/** One icon as a server declares it. */
export interface ServerIcon {
  src: string;
  mimeType?: string;
  theme?: string;
}

const isServerIcon = (value: unknown): value is ServerIcon => typeof (value as ServerIcon | null)?.src === "string";
const usable = (icon: ServerIcon): boolean => /^(data:|https:\/\/)/i.test(icon.src);

/** The icon to show on Studio's dark surfaces: a dark-theme one, else one for any theme, else any; data: or https: only. */
export function pickServerIcon(icons: unknown): ServerIcon | undefined {
  if (!Array.isArray(icons)) return undefined;
  const offered = icons.filter(isServerIcon).filter(usable);
  return offered.find((i) => i.theme === "dark") ?? offered.find((i) => !i.theme) ?? offered[0];
}

/** Bytes as a data: URL, when they are a picture within the cap. */
function pictureDataUrl(bytes: Buffer): string | undefined {
  if (!bytes.length || bytes.length > SERVER_ICON_MAX_BYTES) return undefined;
  const type = pictureType(bytes);
  return type ? `data:${type};base64,${bytes.toString("base64")}` : undefined;
}

/** A data: icon, kept only when its bytes are the picture it says; always handed on as base64. */
export function serverIconDataUrl(src: string): string | undefined {
  const match = DATA_URL.exec(src);
  if (!match) return undefined;
  const [, declared = "", , base64, body = ""] = match;
  let bytes: Buffer;
  try {
    bytes = base64 ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  } catch {
    return undefined;
  }
  // A malformed base64 body decodes to something shorter than it claims; re-encoding tells.
  if (base64 && bytes.toString("base64").replace(/=+$/, "") !== body.replace(/=+$/, "").replace(/\s/g, ""))
    return undefined;
  const picture = pictureDataUrl(bytes);
  return picture?.startsWith(`data:${declared.toLowerCase()};`) ? picture : undefined;
}

/** An https icon's bytes as a data: URL, or undefined when it can't be fetched or isn't a picture within the cap. */
export async function fetchServerIcon(src: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  if (!/^https:\/\//i.test(src)) return undefined;
  try {
    const response = await fetchImpl(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    // A redirect may move the picture, but never off https.
    const landed = response.url === "" || response.url.startsWith("https://");
    if (!response.ok || !landed) return undefined;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > SERVER_ICON_MAX_BYTES) return undefined;
    return pictureDataUrl(Buffer.from(await response.arrayBuffer()));
  } catch {
    return undefined;
  }
}

/** The picture to show for an icon: a data: one as it is, an https one fetched. */
export function resolveServerIcon(icon: ServerIcon, fetchImpl?: typeof fetch): Promise<string | undefined> {
  if (icon.src.startsWith("data:")) return Promise.resolve(serverIconDataUrl(icon.src));
  return fetchServerIcon(icon.src, fetchImpl);
}
