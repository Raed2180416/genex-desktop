/** This Mac's hardware and the local models that fit it, as the harness and the Settings page both read it. */
import { detectHardware, recommendModels } from "../../substrate/hardware.ts";

export async function hardwareReport() {
  return {
    hardware: await detectHardware(),
    recommendation: await recommendModels(),
  };
}
