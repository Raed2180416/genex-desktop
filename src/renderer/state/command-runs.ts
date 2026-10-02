/**
 * Commands the user ran from a chat reply: which reply offered each, the terminal session running
 * it, and whether its result has gone back to that chat. A session's state arrives by the
 * `studio:terminal` push; this store keeps the command sessions' newest state, never their output
 * stream, so a reply can show how its command went and the chat can report it once it ends.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { TerminalKind, type TerminalEvent, type TerminalSession } from "../../shared/terminal.ts";

/** The exit code of a command the user stopped (Stop, or Ctrl+C in the terminal). */
const STOPPED_EXIT_CODE = 130;
const SETTLED_RUNS_PER_THREAD = 50;

/** One press of Run: the reply that offered the command, and the session that runs it. */
export interface CommandRun {
  sessionId: string;
  threadId: string;
  /** The transcript entry (the reply) whose block offered the command. */
  entryId: string;
  command: string;
  /** Its end has been handled: reported to the chat, or deliberately not. */
  settled: boolean;
}

export interface CommandRunsState {
  runs: CommandRun[];
  /** The newest state of every command session seen, by id; a closed session keeps its last one. */
  sessions: Record<string, TerminalSession>;
}

/** The user pressed Run and main started a session for it. */
export function runStarted(state: CommandRunsState, run: Omit<CommandRun, "settled">, session: TerminalSession) {
  // The push may already have told the store more about this session than the reply did.
  const known = state.sessions[session.id] ?? session;
  return {
    runs: [...state.runs, { ...run, settled: false }],
    sessions: { ...state.sessions, [session.id]: known },
  };
}

/** A terminal session changed; only command sessions matter here. */
export function terminalChanged(state: CommandRunsState, event: TerminalEvent): CommandRunsState {
  if (event.type !== "session" || event.session.kind !== TerminalKind.Command) return state;
  return { ...state, sessions: { ...state.sessions, [event.session.id]: event.session } };
}

/** These runs' ends are handled. */
export function runsSettled(state: CommandRunsState, sessionIds: readonly string[]): CommandRunsState {
  const settled = new Set(sessionIds);
  const updated = state.runs.map((run) => (settled.has(run.sessionId) ? { ...run, settled: true } : run));
  const counts = new Map<string, number>();
  const runs = [...updated]
    .reverse()
    .filter((run) => {
      if (!run?.settled) return true;
      const count = (counts.get(run.threadId) ?? 0) + 1;
      counts.set(run.threadId, count);
      return count <= SETTLED_RUNS_PER_THREAD;
    })
    .reverse();
  const kept = new Set(runs.map((run) => run.sessionId));
  const evicted = new Set(updated.filter((run) => !kept.has(run.sessionId)).map((run) => run.sessionId));
  const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([id]) => !evicted.has(id)));
  return { runs, sessions };
}

/** The newest run of this command from this reply, as the store holds it (a selector). */
export function latestRun(
  state: CommandRunsState,
  threadId: string,
  entryId: string,
  command: string,
): CommandRun | undefined {
  return state.runs.findLast((run) => run.threadId === threadId && run.entryId === entryId && run.command === command);
}

/** A chat's runs that have ended and are not yet handled, with how each ended. */
export function endedRuns(state: CommandRunsState, threadId: string): { run: CommandRun; session: TerminalSession }[] {
  return state.runs.flatMap((run) => {
    const session = state.sessions[run.sessionId];
    const ended = run.threadId === threadId && !run.settled && session?.phase === "exited";
    return ended && session ? [{ run, session }] : [];
  });
}

/** An ended command whose result the agent should hear: it ran to its own end, not stopped or broken. */
export function reportsResult(session: TerminalSession): boolean {
  return session.phase === "exited" && session.error === undefined && session.exitCode !== STOPPED_EXIT_CODE;
}

/** How a command session is doing, as a reply's block reads it. */
export const CommandState = {
  Running: "running",
  Stopping: "stopping",
  Done: "done",
  Failed: "failed",
  Stopped: "stopped",
  Broken: "broken",
} as const;
export type CommandState = (typeof CommandState)[keyof typeof CommandState];

export function commandState(session: TerminalSession): CommandState {
  if (session.error !== undefined) return CommandState.Broken;
  if (session.phase === "stopping") return CommandState.Stopping;
  if (session.phase !== "exited") return CommandState.Running;
  if (session.exitCode === 0) return CommandState.Done;
  return session.exitCode === STOPPED_EXIT_CODE ? CommandState.Stopped : CommandState.Failed;
}

export type CommandRunsStore = StoreApi<CommandRunsState>;

export function createCommandRunsStore(): CommandRunsStore {
  return createStore<CommandRunsState>()(() => ({ runs: [], sessions: {} }));
}
