/**
 * Claude's permission questions, in the chat's words: the card's question, what "always" grants
 * and how a request ended. The mode names themselves are Claude Code's (shared/permissions.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alwaysWords,
  bypassPermissionsWords,
  permissionOutcomeWords,
  permissionTitleWords,
} from "../../src/renderer/words.ts";
import type { PermissionGrant, ToolPermissionEvent } from "../../src/shared/permissions.ts";

const ask = (fields: Partial<ToolPermissionEvent>): Partial<ToolPermissionEvent> => ({
  requestId: "r1",
  project: "game",
  threadId: "t1",
  state: "pending",
  input: {},
  ...fields,
});
const rule = (text: string, scope: "game" | "chat" = "game"): PermissionGrant => ({ kind: "rule", rule: text, scope });

describe("permissionTitleWords", () => {
  it("uses Claude Code's own sentence when it wrote one", () => {
    assert.equal(
      permissionTitleWords(ask({ tool: "Bash", title: "Claude wants to run npm install" })),
      "Claude wants to run npm install",
    );
  });

  it("says what each tool is about to do otherwise", () => {
    assert.equal(
      permissionTitleWords(ask({ tool: "Bash", input: { command: "rm -rf dist" } })),
      "Claude wants to run a command",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "Edit", input: { file_path: "/Users/me/game/src/main.ts" } })),
      "Claude wants to edit main.ts",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "NotebookEdit", input: { notebook_path: "/tmp/notes.ipynb" } })),
      "Claude wants to edit notes.ipynb",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "Read", subject: "/Users/me/refs/art.png" })),
      "Claude wants to read /Users/me/refs/art.png",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "Glob", input: { pattern: "~/Music/**/*.wav" } })),
      "Claude wants to read ~/Music/**/*.wav",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "WebFetch", input: { url: "https://docs.example.com/guide?x=1" } })),
      "Claude wants to open docs.example.com",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "WebFetch", subject: "example.org" })),
      "Claude wants to open example.org",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "mcp__sprites__make_sprite_sheet" })),
      "Claude wants to use make sprite sheet",
    );
    assert.equal(
      permissionTitleWords(ask({ tool: "SandboxNetworkAccess", displayName: "Network access" })),
      "Claude wants to use Network access",
    );
    assert.equal(permissionTitleWords(ask({ tool: "Write" })), "Claude wants to edit a file");
  });

  it("asks to approve a plan, whatever Claude Code titled it", () => {
    assert.equal(
      permissionTitleWords(ask({ tool: "ExitPlanMode", title: "Exit plan mode?", plan: "1. Add a jump" })),
      "Approve this plan?",
    );
  });
});

describe("alwaysWords", () => {
  it("names the command prefix a Bash rule allows, and where", () => {
    assert.equal(alwaysWords([rule("Bash(npm test:*)")]), "Always allow npm test commands in this game");
    assert.equal(alwaysWords([rule("Bash(npm test *)", "chat")]), "Always allow npm test commands in this chat");
    assert.equal(alwaysWords([rule("Bash(git push origin main)")]), "Always allow this command in this game");
  });

  it("reads Claude Code's absolute rule paths as plain folders", () => {
    assert.equal(alwaysWords([rule("Read(//Users/me/refs/**)")]), "Always allow reading /Users/me/refs in this game");
    assert.equal(
      alwaysWords([rule("Edit(//Users/me/shared/**)", "chat")]),
      "Always allow editing /Users/me/shared in this chat",
    );
  });

  it("names a domain, a tool, a mode and a folder", () => {
    assert.equal(
      alwaysWords([rule("WebFetch(domain:docs.godotengine.org)")]),
      "Always allow docs.godotengine.org in this game",
    );
    assert.equal(alwaysWords([rule("WebSearch")]), "Always allow WebSearch in this game");
    assert.equal(alwaysWords([rule("mcp__sprites__make_sprite")]), "Always allow make sprite in this game");
    assert.equal(alwaysWords([{ kind: "mode", mode: "acceptEdits" }]), "Allow all edits in this chat");
    assert.equal(
      alwaysWords([{ kind: "directory", path: "/Users/me/refs" }]),
      "Always allow /Users/me/refs in this chat",
    );
  });

  it("names every grant when Claude Code offers several — the choice keeps all of them", () => {
    assert.equal(
      alwaysWords([
        rule("Bash(npm run build:*)"),
        { kind: "directory", path: "/tmp/out" },
        { kind: "mode", mode: "acceptEdits" },
      ]),
      "Always allow npm run build commands in this game, and always allow /tmp/out in this chat, and allow all edits in this chat",
    );
  });
});

describe("permissionOutcomeWords", () => {
  it("says how the person answered", () => {
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "allowed", by: "user", granted: "once" })),
      "Allowed",
    );
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "allowed", by: "user", granted: "always" })),
      "Always allowed",
    );
    assert.equal(permissionOutcomeWords(ask({ tool: "Bash", state: "denied", by: "user" })), "Denied");
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "denied", by: "user", message: "Use pnpm instead" })),
      "Denied · Use pnpm instead",
    );
    assert.equal(
      permissionOutcomeWords(
        ask({ tool: "ExitPlanMode", plan: "1. Jump", state: "allowed", by: "user", mode: "acceptEdits" }),
      ),
      "Plan approved · Accept edits",
    );
    assert.equal(
      permissionOutcomeWords(
        ask({ tool: "ExitPlanMode", plan: "1. Jump", state: "allowed", by: "user", mode: "default" }),
      ),
      "Plan approved · Manual",
    );
  });

  it("says when the work ending withdrew the question", () => {
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "denied", by: "stop" })),
      "Withdrawn when the work stopped",
    );
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "denied", by: "turn" })),
      "Withdrawn when the turn ended",
    );
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "denied", by: "restart" })),
      "Withdrawn by a restart",
    );
    assert.equal(
      permissionOutcomeWords(ask({ tool: "Bash", state: "denied", by: "timeout" })),
      "Withdrawn: nobody answered",
    );
  });
});

describe("bypassPermissionsWords", () => {
  it("names the machine Bypass reaches as the studio's own system calls it", () => {
    assert.match(bypassPermissionsWords("darwin"), /anywhere on this Mac without asking/);
    assert.match(bypassPermissionsWords(""), /this Mac/, "macOS's words until main has said");
    for (const platform of ["win32", "linux"])
      assert.equal(
        bypassPermissionsWords(platform),
        "Claude will run commands and change files anywhere on this computer without asking. Rewind restores only the game folder.",
        platform,
      );
  });
});
