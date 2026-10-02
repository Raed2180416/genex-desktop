import { SECOND_MS } from "../shared/duration.ts";

const FLUSH_MS = SECOND_MS / 20;
const MAX_PENDING_CHARS = 64 * 1024;

/** A renderer log message; persisted studio.log writes stay synchronous at their producer. */
export interface HarnessLogMessage {
  line: string;
  stream: "stdout" | "stderr";
}

/** Coalesce renderer-only log traffic without changing stdout/stderr ordering. */
export class HarnessLogBatch {
  readonly #send: (message: HarnessLogMessage) => void;
  #messages: HarnessLogMessage[] = [];
  #size = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(send: (message: HarnessLogMessage) => void) {
    this.#send = send;
  }

  /** Queue a line until the bounded batch fills or its short cadence elapses. */
  push(line: string, stream: HarnessLogMessage["stream"]): void {
    if (this.#size + line.length + 1 > MAX_PENDING_CHARS) this.flush();
    if (line.length >= MAX_PENDING_CHARS) {
      this.#send({ line, stream });
      return;
    }
    const last = this.#messages.at(-1);
    if (last?.stream === stream) last.line += `\n${line}`;
    else this.#messages.push({ line, stream });
    this.#size += line.length + 1;
    this.#timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Deliver before another UI event or shutdown, and release the scheduled callback. */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const messages = this.#messages;
    this.#messages = [];
    this.#size = 0;
    for (const message of messages) this.#send(message);
  }
}
