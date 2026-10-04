/**
 * The in-window update prompt: which new version waits (downloaded, or a Linux release to
 * download), the restart that installs it, the download page, and Check for Updates. Registered
 * once per launch with the boot channels, before any core: the announcer (`../auto-update.ts`)
 * holds the state, so the channels answer the same before and after startup.
 */
import type { AppAbout, UpdateCheckResult } from "../../shared/app-update.ts";
import type { UpdateAnnouncer } from "../auto-update.ts";
import type { IpcHandle } from "./registrar.ts";

export interface UpdateIpcDeps {
  updates: Pick<UpdateAnnouncer, "ready" | "restart" | "download">;
  /** Check for Updates (`createUpdateChecker`). */
  check(): Promise<UpdateCheckResult>;
  /** What is running, for Settings → About. */
  about(): AppAbout;
}

export function registerUpdateIpc(handle: IpcHandle, { updates, check, about }: UpdateIpcDeps): void {
  handle("studio:update", () => updates.ready());
  handle("studio:update.restart", () => updates.restart());
  handle("studio:update.check", () => check());
  handle("studio:update.about", () => about());
  // No URL from the page: only the release page main checked and holds opens.
  handle("studio:update.download", () => updates.download());
}
