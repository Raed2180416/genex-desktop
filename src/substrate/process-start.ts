import { setTimeout as delay } from "node:timers/promises";

/** A promisified execFile exposes the ChildProcess even when spawn is refused. */
export type PendingProcess<T> = Promise<T> & { child: { pid?: number } };

/** The waits before each retry of a refused spawn; one entry per retry. */
const SPAWN_RETRY_BACKOFFS_MS = [100, 250] as const;

/**
 * Recover a transient OS admission refusal, never replay an executed command.
 * EAGAIN alone is insufficient: there must be no child PID and the error must come
 * from spawn. Exit codes, signals, timeouts and missing executables pass through.
 */
export async function startWithRecovery<T>(
  start: () => PendingProcess<T>,
  options: { signal?: AbortSignal; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<T> {
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    const pending = start();
    try {
      return await pending;
    } catch (error) {
      options.signal?.throwIfAborted();
      const backoff = SPAWN_RETRY_BACKOFFS_MS[attempt];
      if (backoff === undefined || !isSpawnAdmissionRefusal(pending, error)) throw error;
      await wait(backoff, options.signal);
    }
  }
}

/** The OS refused to start the process at all: EAGAIN from spawn, and no child ever got a PID. */
function isSpawnAdmissionRefusal(pending: PendingProcess<unknown>, error: unknown): boolean {
  const failure = error as NodeJS.ErrnoException | null;
  return (
    pending.child.pid === undefined && failure?.code === "EAGAIN" && failure.syscall?.startsWith("spawn ") === true
  );
}
