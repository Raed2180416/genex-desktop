import { CliInstallOperation } from "../../shared/cli-install.ts";
import type { CliInstalls } from "../cli-install.ts";
import type { IpcHandle } from "./registrar.ts";

/**
 * The Install buttons: Claude Code's or Codex's own installer, run for the person. The page names
 * only which CLI; the service refuses anything else before any work.
 */
export function registerCliInstallIpc(handle: IpcHandle, installs: Pick<CliInstalls, "start" | "status">): void {
  handle("studio:cli-install.start", (payload) => installs.start(payload?.provider));
  handle("studio:cli.update", (payload) => installs.start(payload?.provider, CliInstallOperation.Update));
  handle("studio:cli-install.status", () => installs.status());
}
