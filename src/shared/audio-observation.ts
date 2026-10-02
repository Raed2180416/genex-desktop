export interface AudioPlaybackEvidence {
  file: string;
  state: "playing" | "muted" | "paused" | "failed" | "silent" | "unavailable";
  rms: number | null;
  advancedSeconds: number;
  detail: string;
}
