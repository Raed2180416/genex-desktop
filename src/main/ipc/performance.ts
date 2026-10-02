import { PerformanceMarkName } from "../../shared/performance.ts";
import type { PerformanceRecorder } from "../performance.ts";
import type { IpcHandle } from "./registrar.ts";

/** Content-free, fixture-safe journey telemetry; never a general logging or evaluation channel. */
export function registerPerformanceIpc(handle: IpcHandle, recorder: PerformanceRecorder): void {
  handle("studio:performance.mark", (payload) => {
    const validName = payload && Object.values(PerformanceMarkName).includes(payload.name);
    const validTime = payload && Number.isFinite(payload.at) && payload.at >= 0;
    if (!validName || !validTime) return false;
    recorder.rendererMark(payload);
    return true;
  });
}
