/**
 * Chat = one folder + one contractor session. These helpers are the load-bearing shape:
 * a follow-up never guesses a sibling game, and "keep going" without a session still
 * carries the original ask instead of briefing a blank new job.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContractorBrief,
  isContinueAsk,
  lastContractorSession,
  originalAsk,
  resolveChatProject,
} from "../../src/harness-seed/loop/chat-session.ts";
import { fencedCommand } from "../../src/shared/terminal.ts";

type ChatMessage = { role: string; content: string };

describe("chat session helpers", () => {
  it("recognises keep-going phrasing, including a stretched keep", () => {
    assert.equal(isContinueAsk("keeep going plz"), true);
    assert.equal(isContinueAsk("Keep going from where we left off."), true);
    assert.equal(isContinueAsk("continue"), true);
    assert.equal(isContinueAsk("resume the build"), true);
    assert.equal(isContinueAsk("I want a rainy night city"), false);
  });

  it("never guesses a project from preview or newest-game", () => {
    const games = [
      { name: "older", dir: "/games/older" },
      { name: "newer", dir: "/games/newer" },
    ];
    assert.equal(resolveChatProject({}, games), null);
    assert.equal(resolveChatProject({ project: "missing" }, games), null);
    assert.equal(resolveChatProject({ newProject: true, project: "older" }, games), null);
    assert.equal(resolveChatProject({ project: "older" }, games), "older");
  });

  it("skips keep-going lines when finding the original ask", () => {
    assert.equal(
      originalAsk([
        { role: "user", content: "Keep going" },
        { role: "user", content: "Build a megastructure of rusted walkways" },
        { role: "user", content: "Keep going from where we left off." },
      ] as ChatMessage[]),
      "Build a megastructure of rusted walkways",
    );
  });

  it("a keep-going brief without resume includes the original ask", () => {
    const brief = buildContractorBrief({
      ask: "Keep going",
      messages: [
        { role: "user", content: "Make Blame! — a vertical megastructure" },
        { role: "assistant", content: "Handing this to the contractor." },
        { role: "user", content: "Keep going" },
      ] as ChatMessage[],
      folderLabel: "AI Games/blame",
    });
    assert.match(brief, /Make Blame!/);
    assert.match(brief, /Latest instruction:\nKeep going/);
    assert.match(brief, /this workspace \(folder `AI Games\/blame`\)/);
    assert.doesNotMatch(brief, /You are resuming your own session/);
  });

  it("a resume brief is a short pickup, not a re-brief of the original job", () => {
    const brief = buildContractorBrief({
      ask: "Keep going",
      messages: [{ role: "user", content: "Make Blame!" }] as ChatMessage[],
      resume: true,
      folderLabel: "AI Games/blame",
    });
    assert.match(brief, /resuming your own session/i);
    assert.doesNotMatch(brief, /Original request/);
  });

  it("reads the last contractor session from the log, newest last", () => {
    const found = lastContractorSession(
      [
        {
          data: {
            type: "custom",
            event_type: "delegation_incomplete",
            payload: { sessionId: "ses_old", engine: "vendor", project: "older" },
          },
        },
        {
          data: {
            type: "custom",
            event_type: "contractor_session",
            payload: { sessionId: "ses_ok", engine: "vendor", project: "older" },
          },
        },
      ],
      "vendor",
    );
    assert.deepEqual(found, { sessionId: "ses_ok", engine: "vendor", project: "older" });
  });

  it("tells a chat build to hand a blocked step to the user in a block the chat can run", () => {
    const brief = buildContractorBrief({ ask: "Add engine sounds" });
    const fence = /one command on a single line in a ```(\w+) block/.exec(brief)?.[1];
    assert.ok(fence, "the brief names the fence a command for the user goes in");
    assert.equal(fencedCommand("brew install ffmpeg", fence), "brew install ffmpeg");
  });
});
