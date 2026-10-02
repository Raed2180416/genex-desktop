/**
 * A CPU profile of the main process itself, for the developer control's `main.cpu.start` and
 * `main.cpu.stop`. The renderer profiles go through each webContents' debugger; main has none, so
 * this one opens an in-process inspector session for the length of the profile.
 */
import { Session } from "node:inspector/promises";

/** Sample every 100 µs: fine enough to name a 16 ms stall's frames. */
const SAMPLING_INTERVAL_US = 100;

/** One main-process profile at a time, by the id it was started with. */
export class MainProfiler {
  #active: { id: string; session: Session } | null = null;

  /** Whether a profile is being recorded, and under which id. */
  get active(): string | null {
    return this.#active?.id ?? null;
  }

  /** Start sampling; false when a profile is already running. */
  async start(id: string): Promise<boolean> {
    if (this.#active) return false;
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: SAMPLING_INTERVAL_US });
    await session.post("Profiler.start");
    this.#active = { id, session };
    return true;
  }

  /** Stop the profile named `id` and return it; null when that profile is not the one running. */
  async stop(id: string): Promise<{ nodes: unknown[]; startTime: number; endTime: number } | null> {
    const active = this.#active;
    if (!active || active.id !== id) return null;
    this.#active = null;
    try {
      const { profile } = await active.session.post("Profiler.stop");
      return profile;
    } finally {
      active.session.disconnect();
    }
  }
}
