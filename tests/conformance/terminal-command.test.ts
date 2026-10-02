import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandOutput, COMMAND_OUTPUT_LINES } from "../../src/main/terminal-command.ts";
import { fencedCommand, runnableCommand, TERMINAL_LIMITS } from "../../src/shared/terminal.ts";
import { plainTerminalLines } from "../../src/shared/terminal-text.ts";

describe("commands a chat reply can offer", () => {
  it("accepts one plain line, trimmed", () => {
    assert.equal(runnableCommand("  brew install ffmpeg "), "brew install ffmpeg");
    assert.equal(runnableCommand("echo 'a && b' | tr a-z A-Z"), "echo 'a && b' | tr a-z A-Z");
    assert.equal(fencedCommand("npm test", "bash"), "npm test");
    assert.equal(fencedCommand("npm test", "python"), null);
    assert.equal(fencedCommand("npm test", undefined), null);
  });
  it("refuses anything that is not one command line", () => {
    const hostile: [string, unknown][] = [
      ["not a string", { command: "ls" }],
      ["a number", 42],
      ["null", null],
      ["empty", "   "],
      ["a second line", "ls\nrm -rf ~"],
      ["a carriage return", "ls\rrm -rf ~"],
      ["a NUL", "ls\u0000rm"],
      ["an escape sequence", "echo \u001b[31mred"],
      ["a C1 control", "echo \u009b31m"],
      ["a tab", "ls\t-la"],
      ["a prompt transcript", "$ ls"],
      ["a comment", "# ls"],
      ["too long", "x".repeat(TERMINAL_LIMITS.command + 1)],
    ];
    for (const [name, value] of hostile) assert.equal(runnableCommand(value), null, name);
  });
});

describe("what a finished command hands back", () => {
  it("keeps the last lines as plain text: colours, links and overwritten progress removed", () => {
    const raw =
      "\u001b[32m==> Downloading\u001b[0m\r\n" +
      "10%\r50%\r100%\r\n" +
      "\u001b]8;;https://brew.sh\u0007brew.sh\u001b]8;;\u0007 done\r\n" +
      "\r\n" +
      "   \r\n";
    assert.deepEqual(commandOutput(raw), ["==> Downloading", "100%", "brew.sh done"]);
  });
  it("keeps only the tail and redacts credentials", () => {
    const lines = Array.from({ length: COMMAND_OUTPUT_LINES + 5 }, (_, n) => `line ${n}`);
    const raw = `${lines.join("\r\n")}\r\nexport OPENAI=sk-abcdefghijklmnopqrstuvwx\r\n`;
    const output = commandOutput(raw);
    assert.equal(output.length, COMMAND_OUTPUT_LINES);
    assert.equal(output.at(-2), `line ${COMMAND_OUTPUT_LINES + 4}`);
    assert.doesNotMatch(output.at(-1) ?? "", /sk-abcdefghijklmnopqrstuvwx/);
  });
  it("shortens a line too long to read", () => {
    const [line] = commandOutput(`${"y".repeat(5000)}\n`);
    assert.ok(line && line.length < 400);
  });
});

describe("terminal output as the chat shows it", () => {
  it("drops titles, cursor moves, charset switches and stray controls, keeping blank lines", () => {
    const raw = "\u001b]0;brew\u0007\u001b[2K\u001b(Bfirst\u0008\n\nsecond\u001b[1A\u001b7 \r\n";
    assert.deepEqual(plainTerminalLines(raw), ["first", "", "second", ""]);
  });
});
