/** The studio's own settings, the diagnostics report Settings copies, and the shipped licenses. */
import type { LicenseTexts } from "../../shared/licenses.ts";
import type { StudioCore } from "../studio-core.ts";
import type { IpcHandle } from "./registrar.ts";

export interface SettingsIpcDeps {
  core: Pick<StudioCore, "settings" | "updateSettings">;
  /** The redacted report (`main/diagnostics.ts`). */
  diagnostics(): Promise<string>;
  /** The license texts in the app's resources (`main/licenses.ts`). */
  licenses(): Promise<LicenseTexts>;
}

export function registerSettingsIpc(handle: IpcHandle, { core, diagnostics, licenses }: SettingsIpcDeps): void {
  handle("studio:settings", async () => core.settings);
  handle("studio:settings.set", async (payload) => core.updateSettings(payload));
  handle("studio:diagnostics", () => diagnostics());
  handle("studio:licenses", () => licenses());
}
