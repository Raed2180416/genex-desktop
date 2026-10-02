/** Settings → Privacy: Share build metrics, See what would be sent, Delete what I shared (`../run-sharing.ts`). */
import type { RunSharing } from "../run-sharing.ts";
import type { IpcHandle } from "./registrar.ts";

/** The sender the channels drive. */
export interface RunSharingIpcDeps {
  sharing: RunSharing;
}

/** Why a switch request was refused; the page is a browser, so its payload is checked here. */
const MESSAGE = { notASwitch: "run-sharing.set takes { on: boolean }" } as const;

/** Whether a payload is exactly a switch request. */
const isSwitchRequest = (payload: unknown): payload is { on: boolean } =>
  typeof payload === "object" && payload !== null && "on" in payload && typeof payload.on === "boolean";

/** The switch position a `run-sharing.set` payload asks for; throws for anything but `{ on: boolean }`. */
function switchPosition(payload: unknown): boolean {
  if (!isSwitchRequest(payload)) throw new Error(MESSAGE.notASwitch);
  return payload.on;
}

/** Registers the four Privacy channels. */
export function registerRunSharingIpc(handle: IpcHandle, { sharing }: RunSharingIpcDeps): void {
  handle("studio:run-sharing.status", () => sharing.status());
  handle("studio:run-sharing.set", (payload) => sharing.setOn(switchPosition(payload)));
  handle("studio:run-sharing.preview", () => sharing.preview());
  handle("studio:run-sharing.delete", () => sharing.deleteShared());
}
