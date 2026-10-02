/**
 * Controlled read gates for the isolated build smoke only. The smoke holds or fails the
 * renderer's bootstrap and thread reads to prove that pending and unavailable data never look
 * like empty data; outside `--studio-smoke` the IPC layer is given no gates at all.
 */
export interface SmokeReadGates {
  bootstrap?: Promise<void>;
  thread?: Promise<void>;
  failBootstrap?: boolean;
  failThread?: boolean;
}
