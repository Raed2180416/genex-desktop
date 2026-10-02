import { TERMINAL_LIMITS } from "../shared/terminal.ts";

/** Why terminal output is refused. */
const MESSAGE = {
  bufferFull: "Terminal output exceeded its buffer limit",
} as const;

/** Credits count UTF-16 code units, exactly as Terminal.write's callback acknowledges them. */
export class TerminalFlow {
  #queue = "";
  #inFlight = 0;
  #attached = false;
  #paused = false;
  private readonly send: (data: string) => void;
  private readonly pause: (paused: boolean) => void;
  constructor(send: (data: string) => void, pause: (paused: boolean) => void) {
    this.send = send;
    this.pause = pause;
  }
  get pending(): number {
    return this.#queue.length + this.#inFlight;
  }
  append(data: string): void {
    if (this.pending + data.length > TERMINAL_LIMITS.queue) throw new Error(MESSAGE.bufferFull);
    this.#queue += data;
    this.#pressure();
  }
  attach(): void {
    this.#attached = true;
    this.flush();
  }
  acknowledge(count: number): void {
    const acknowledgesSent = Number.isInteger(count) && count >= 1 && count <= this.#inFlight;
    if (!acknowledgesSent) return;
    this.#inFlight -= count;
    this.flush();
  }
  flush(): void {
    while (this.#attached && this.#queue.length && this.#inFlight < TERMINAL_LIMITS.inFlight) {
      let count = Math.min(this.#queue.length, TERMINAL_LIMITS.chunk, TERMINAL_LIMITS.inFlight - this.#inFlight);
      // Keep a surrogate pair together across IPC chunks.
      if (count < this.#queue.length && /[\uD800-\uDBFF]/.test(this.#queue.charAt(count - 1))) count--;
      if (!count) break;
      const data = this.#queue.slice(0, count);
      this.#queue = this.#queue.slice(count);
      this.#inFlight += count;
      this.send(data);
    }
    this.#pressure();
  }
  #pressure(): void {
    const next = this.#paused ? this.pending > TERMINAL_LIMITS.inFlight / 2 : this.pending >= TERMINAL_LIMITS.inFlight;
    if (next !== this.#paused) {
      this.#paused = next;
      this.pause(next);
    }
  }
}
