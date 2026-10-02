/**
 * What the commands a reply offered have printed, for the output panel under each one. Terminal
 * output never enters React state: the studio's one terminal subscription appends it here, and the
 * panel draws it imperatively when told something arrived. Only command sessions are kept, each
 * bounded, and only the newest few, so a scrolled-away reply still shows its output when it returns.
 */
import { TerminalKind, type TerminalEvent } from "../../shared/terminal.ts";

/** How much of one command's newest output is kept. */
export const COMMAND_OUTPUT_CHARS = 65_536;
/** How many commands' output is kept; the oldest is forgotten first. */
export const COMMAND_OUTPUTS_KEPT = 16;

export interface CommandOutput {
  /** Feed one terminal event: a command session starts being kept, its data is appended. */
  terminalEvent(event: TerminalEvent): void;
  /** What this session has printed so far, from the start of a line. */
  read(sessionId: string): string;
  /** Hear that this session printed more. Returns the unsubscribe. */
  subscribe(sessionId: string, listener: () => void): () => void;
}

/** The newest output, at most {@link COMMAND_OUTPUT_CHARS}, starting at a whole line once it is cut. */
function keepNewest(text: string): string {
  if (text.length <= COMMAND_OUTPUT_CHARS) return text;
  const cut = text.slice(-COMMAND_OUTPUT_CHARS);
  const line = cut.indexOf("\n");
  return line < 0 ? cut : cut.slice(line + 1);
}

export function createCommandOutput(): CommandOutput {
  const outputs = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const keep = (sessionId: string): void => {
    if (outputs.has(sessionId)) return;
    outputs.set(sessionId, "");
    const oldest = outputs.keys().next().value;
    if (outputs.size > COMMAND_OUTPUTS_KEPT && oldest !== undefined) outputs.delete(oldest);
  };
  return {
    terminalEvent(event) {
      if (event.type === "session" && event.session.kind === TerminalKind.Command) keep(event.session.id);
      if (event.type !== "data") return;
      const kept = outputs.get(event.id);
      if (kept === undefined) return;
      outputs.set(event.id, keepNewest(kept + event.data));
      for (const listener of listeners.get(event.id) ?? []) listener();
    },
    read: (sessionId) => outputs.get(sessionId) ?? "",
    subscribe(sessionId, listener) {
      const set = listeners.get(sessionId) ?? new Set();
      set.add(listener);
      listeners.set(sessionId, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(sessionId);
      };
    },
  };
}
