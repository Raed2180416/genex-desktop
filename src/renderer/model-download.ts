/** A local model's download as its Settings row shows it after the download stopped short. */
import { InstallPhase, type ModelInstallJob } from "../shared/model-install.ts";

/** The phases of a download that ended before its model was ready. */
const STOPPED_PHASES: ReadonlySet<InstallPhase> = new Set([
  InstallPhase.Failed,
  InstallPhase.Cancelled,
  InstallPhase.Interrupted,
]);

/** A download that stopped before its model was ready. */
export interface StoppedDownload {
  /** Bytes were saved, so the row offers Resume instead of Download. */
  resumable: boolean;
  /** How much of the download is saved, 0–100, never rounded up to a finish. */
  percent: number;
  /** Why it stopped, as the installer worded it. */
  reason: string | null;
  /** The person stopped it, so it is not worded as an error. */
  cancelled: boolean;
}

/** Whether `job` is `model`'s download and it ended short. */
const stoppedFor = (job: ModelInstallJob, model: string): boolean =>
  !job.active && job.model === model && STOPPED_PHASES.has(job.phase);

/** How `model`'s last download stopped, or null when it runs, finished, or was another model's. */
export function stoppedDownload(job: ModelInstallJob | null, model: string): StoppedDownload | null {
  if (!job || !stoppedFor(job, model)) return null;
  const share = job.total ? job.completed / job.total : 0;
  return {
    resumable: job.completed > 0,
    percent: Math.floor(share * 100),
    reason: job.error ?? null,
    cancelled: job.phase === InstallPhase.Cancelled,
  };
}
