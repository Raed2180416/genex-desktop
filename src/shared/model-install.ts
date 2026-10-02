/** Where a model or runtime install is. Persisted in install records: never rename a value. */
export const InstallPhase = {
  Preflight: "preflight",
  Downloading: "downloading",
  Verifying: "verifying",
  Extracting: "extracting",
  Installed: "installed",
  Starting: "starting",
  Ready: "ready",
  Failed: "failed",
  Cancelled: "cancelled",
  Interrupted: "interrupted",
} as const;
export type InstallPhase = (typeof InstallPhase)[keyof typeof InstallPhase];
/** A plugin runtime install's phase: a runtime is not started, so it skips `installed` and `starting`. */
export type RuntimeInstallPhase = Exclude<InstallPhase, typeof InstallPhase.Installed | typeof InstallPhase.Starting>;
export interface ModelInstallJob {
  id: string;
  model: string;
  phase: InstallPhase;
  completed: number;
  total: number;
  requiredBytes?: number;
  availableBytes?: number;
  location: string;
  updatedAt: string;
  error?: string;
  active: boolean;
}
