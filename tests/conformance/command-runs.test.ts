/**
 * Commands a reply offered and the user ran: the store that follows their sessions, what the chat
 * reports when one ends, and the studio's one terminal subscription that feeds it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CommandState,
  commandState,
  createCommandRunsStore,
  endedRuns,
  latestRun,
  reportsResult,
  runsSettled,
  runStarted,
  terminalChanged,
} from "../../src/renderer/state/command-runs.ts";
import {
  COMMAND_OUTPUT_CHARS,
  COMMAND_OUTPUTS_KEPT,
  createCommandOutput,
} from "../../src/renderer/state/command-output.ts";
import { createStudio } from "../../src/renderer/state/studio.ts";
import { commandResultWords } from "../../src/renderer/words.ts";
import { TerminalKind, type TerminalSession } from "../../src/shared/terminal.ts";
import { fakeStudioApi } from "../helpers/fake-studio-api.ts";

const session = (patch: Partial<TerminalSession> = {}): TerminalSession => ({
  id: "s1",
  title: "brew install ffmpeg",
  kind: TerminalKind.Command,
  project: "derby",
  phase: "starting",
  command: "brew install ffmpeg",
  ...patch,
});
const run = { sessionId: "s1", threadId: "derby-chat", entryId: "reply-1", command: "brew install ffmpeg" };

describe("the command runs store", () => {
  it("follows a run's session from Run to its end, once per chat", () => {
    let state = createCommandRunsStore().getState();
    state = runStarted(state, run, session());
    assert.equal(latestRun(state, "derby-chat", "reply-1", "brew install ffmpeg")?.sessionId, "s1");
    assert.equal(latestRun(state, "derby-chat", "reply-2", "brew install ffmpeg"), undefined);
    state = terminalChanged(state, { type: "session", session: session({ phase: "running" }) });
    assert.deepEqual(endedRuns(state, "derby-chat"), [], "a running command has nothing to report");
    const finished = session({ phase: "exited", exitCode: 0, output: ["ffmpeg 7.1 installed"] });
    state = terminalChanged(state, { type: "session", session: finished });
    assert.deepEqual(endedRuns(state, "other-chat"), []);
    const ended = endedRuns(state, "derby-chat");
    assert.deepEqual(
      ended.map(({ run, session }) => [run.command, session.exitCode]),
      [["brew install ffmpeg", 0]],
    );
    state = runsSettled(state, ["s1"]);
    assert.deepEqual(endedRuns(state, "derby-chat"), [], "a settled run is reported once");
  });
  it("keeps only the newest settled commands per chat while retaining unfinished commands", () => {
    let state = createCommandRunsStore().getState();
    state = runStarted(state, { ...run, sessionId: "pending" }, session({ id: "pending" }));
    for (let id = 0; id < 100; id++) {
      const sessionId = `ended-${id}`;
      state = runStarted(state, { ...run, sessionId }, session({ id: sessionId, phase: "exited" }));
      state = runsSettled(state, [sessionId]);
    }
    assert.equal(state.runs.length, 51);
    assert.equal(Object.keys(state.sessions).length, 51);
    assert.ok(state.runs.some((item) => item.sessionId === "pending"));
    assert.equal(state.runs.at(-1)?.sessionId, "ended-99");
  });

  it("keeps what the push said when it arrives before Run's own answer", () => {
    let state = createCommandRunsStore().getState();
    state = terminalChanged(state, { type: "session", session: session({ phase: "exited", exitCode: 0 }) });
    state = runStarted(state, run, session());
    assert.equal(endedRuns(state, "derby-chat").length, 1);
  });
  it("ignores the project shell and sign-in sessions", () => {
    const state = createCommandRunsStore().getState();
    const shell = { type: "session", session: session({ kind: TerminalKind.Shell }) } as const;
    assert.equal(terminalChanged(state, shell), state);
    assert.equal(terminalChanged(state, { type: "removed", id: "s1" }), state);
  });
  it("reports a command that ran to its end, and leaves a stopped or broken one to the user", () => {
    const cases: [string, Partial<TerminalSession>, CommandState, boolean][] = [
      ["running", { phase: "running" }, CommandState.Running, false],
      ["stopping", { phase: "stopping" }, CommandState.Stopping, false],
      ["done", { phase: "exited", exitCode: 0 }, CommandState.Done, true],
      ["failed", { phase: "exited", exitCode: 2 }, CommandState.Failed, true],
      ["stopped", { phase: "exited", exitCode: 130 }, CommandState.Stopped, false],
      ["broken", { phase: "exited", exitCode: 1, error: "The terminal could not start." }, CommandState.Broken, false],
    ];
    for (const [name, patch, state, reports] of cases) {
      assert.equal(commandState(session(patch)), state, name);
      assert.equal(reportsResult(session(patch)), reports, name);
    }
  });
});

describe("what the chat tells the agent when a command ends", () => {
  it("names the command, how it ended and its last lines", () => {
    assert.equal(
      commandResultWords("brew install ffmpeg", { exitCode: 0, output: ["==> Pouring", "ffmpeg 7.1 installed"] }),
      "I ran this in the terminal:\nbrew install ffmpeg\n\nIt finished (exit code 0). The last lines it printed:\n==> Pouring\nffmpeg 7.1 installed",
    );
    assert.match(
      commandResultWords("pip install pillow", { exitCode: 1, output: [] }),
      /failed \(exit code 1\)\. It printed nothing\.$/,
    );
  });
});

describe("what a command printed, kept for the chat's output card", () => {
  it("keeps only command sessions' output and tells that session's listeners", () => {
    const output = createCommandOutput();
    let heard = 0;
    const unsubscribe = output.subscribe("s1", () => heard++);
    output.terminalEvent({ type: "data", id: "s1", data: "before the session is known\n" });
    output.terminalEvent({ type: "session", session: session() });
    output.terminalEvent({ type: "session", session: session({ id: "shell", kind: TerminalKind.Shell }) });
    output.terminalEvent({ type: "data", id: "s1", data: "==> Pouring\r\n" });
    output.terminalEvent({ type: "data", id: "shell", data: "private shell output" });
    assert.equal(output.read("s1"), "==> Pouring\r\n");
    assert.equal(output.read("shell"), "");
    assert.equal(heard, 1);
    unsubscribe();
    output.terminalEvent({ type: "data", id: "s1", data: "done\n" });
    assert.equal(heard, 1);
  });
  it("keeps the newest output from a whole line, and only the newest commands", () => {
    const output = createCommandOutput();
    output.terminalEvent({ type: "session", session: session() });
    output.terminalEvent({ type: "data", id: "s1", data: `${"x".repeat(COMMAND_OUTPUT_CHARS)}\nlast line\n` });
    assert.equal(output.read("s1"), "last line\n");
    for (let n = 0; n < COMMAND_OUTPUTS_KEPT; n++)
      output.terminalEvent({ type: "session", session: session({ id: `later-${n}` }) });
    output.terminalEvent({ type: "data", id: "s1", data: "forgotten\n" });
    assert.equal(output.read("s1"), "", "the oldest command's output is dropped first");
  });
});

describe("the studio feeds command sessions from its one terminal subscription", () => {
  it("records a command session's changes and output, and unsubscribes on stop", () => {
    const fake = fakeStudioApi();
    const app = createStudio(fake.api, { storage: null });
    const stop = app.start();
    try {
      fake.emitTerminal({ type: "session", session: session({ phase: "running" }) });
      fake.emitTerminal({ type: "data", id: "s1", data: "ffmpeg 7.1 installed\n" });
      assert.equal(app.commandRuns.getState().sessions.s1?.phase, "running");
      assert.equal(app.commandOutput.read("s1"), "ffmpeg 7.1 installed\n");
    } finally {
      stop();
    }
    assert.equal(fake.listeners("onTerminal"), 0);
  });
});
