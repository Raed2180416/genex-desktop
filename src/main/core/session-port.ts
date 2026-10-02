/** A delegated session's own window, borrowed from the preview pool for as long as the session runs. */
import type { PreviewPort } from "../../substrate/preview-port.ts";

/**
 * A delegation's window: the port it looks at and drives for the whole session, and what
 * that port currently shows (`loaded`), so capture and the computer tool agree on reloads.
 */
export interface SessionPort {
  loaded: { root: string; at: number } | null;
  handle(): string | null;
  get(): Promise<PreviewPort>;
  release(): Promise<void>;
}
