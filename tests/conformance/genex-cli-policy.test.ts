/**
 * Which Genex CLI commands an agent may run through `genex__cli` and `genex__cli-paid`, and the
 * exact argv Studio hands the pinned CLI. Everything else is a typed refusal that names what to use
 * instead; nothing here spawns anything.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GenexCliCommand,
  GenexCliRefusal,
  GenexCliRefusalCode,
  genexCliConsentArgs,
  genexCliRequest,
} from "../../src/main/core/genex-cli-policy.ts";
import { consentArgsDigest } from "../../src/main/core/plugin-tools.ts";
import { consentAskWords } from "../../src/renderer/words.ts";

const FREE = { paid: false };
const PAID = { paid: true };

/** The refusal a call throws, so a row can name its code. */
function refusal(args: Record<string, unknown>, tool: { paid: boolean }): GenexCliRefusal {
  try {
    genexCliRequest(args, tool);
  } catch (error) {
    assert.ok(error instanceof GenexCliRefusal, `expected a typed refusal, got ${String(error)}`);
    return error;
  }
  assert.fail(`${JSON.stringify(args)} was not refused`);
}

describe("commands the agent may not run", () => {
  const rows: Array<[string, Record<string, unknown>, { paid: boolean }, GenexCliRefusalCode, RegExp?]> = [
    ["auth", { command: "auth" }, FREE, GenexCliRefusalCode.Unavailable],
    ["login", { command: "login" }, FREE, GenexCliRefusalCode.Unavailable],
    ["tools", { command: "tools" }, FREE, GenexCliRefusalCode.Unavailable],
    ["init", { command: "init" }, PAID, GenexCliRefusalCode.Unavailable],
    ["player", { command: "player install" }, FREE, GenexCliRefusalCode.Unavailable],
    ["remix", { command: "remix" }, FREE, GenexCliRefusalCode.Unavailable],
    ["domain", { command: "domain" }, PAID, GenexCliRefusalCode.Unavailable],
    ["llm price", { command: "llm price" }, FREE, GenexCliRefusalCode.Unavailable],
    ["help", { command: "help" }, FREE, GenexCliRefusalCode.Unavailable],
    ["an empty command", { command: "  " }, FREE, GenexCliRefusalCode.Unavailable],
    ["publish", { command: "publish" }, FREE, GenexCliRefusalCode.UseTool, /genex__publish/],
    ["preview", { command: "preview" }, PAID, GenexCliRefusalCode.UseTool, /genex__publish/],
    ["image", { command: "image" }, FREE, GenexCliRefusalCode.UseTool, /genex__asset/],
    ["animations", { command: "animations search", args: "run" }, FREE, GenexCliRefusalCode.UseTool, /genex__asset/],
    ["a flag in the command", { command: "doctor --json" }, FREE, GenexCliRefusalCode.Unavailable],
    [
      "a paid command through the free tool",
      { command: "llm bench", args: "hi", options: { "max-coins": 5 } },
      FREE,
      GenexCliRefusalCode.PaidTool,
      /genex__cli-paid/,
    ],
    [
      "shop add through the free tool",
      { command: "shop add", args: "Key", options: { price: 100 } },
      FREE,
      GenexCliRefusalCode.PaidTool,
    ],
    [
      "budget --assets through the free tool, an allowance no Studio run keeps",
      { command: "budget", options: { assets: 50 } },
      FREE,
      GenexCliRefusalCode.UnknownOption,
      /Studio/,
    ],
    [
      "budget --assets through the paid tool",
      { command: "budget", options: { assets: 50 } },
      PAID,
      GenexCliRefusalCode.UnknownOption,
      /Studio/,
    ],
    [
      "a free command through the paid tool",
      { command: "shop list" },
      PAID,
      GenexCliRefusalCode.FreeTool,
      /genex__cli\b/,
    ],
    ["plain budget through the paid tool", { command: "budget" }, PAID, GenexCliRefusalCode.FreeTool],
  ];
  for (const [name, args, tool, code, names] of rows) {
    it(`refuses ${name}`, () => {
      const refused = refusal(args, tool);
      assert.equal(refused.code, code);
      if (names) assert.match(refused.message, names);
    });
  }
});

describe("flags and values the agent may not pass", () => {
  const rows: Array<[string, Record<string, unknown>, { paid: boolean }, GenexCliRefusalCode]> = [
    ["--env", { command: "doctor", options: { env: "/tmp/x" } }, FREE, GenexCliRefusalCode.ReservedFlag],
    ["--dir", { command: "llm models", options: { dir: "/" } }, FREE, GenexCliRefusalCode.ReservedFlag],
    [
      "--user-approved",
      { command: "llm bench", args: "hi", options: { "max-coins": 5, "user-approved": true } },
      PAID,
      GenexCliRefusalCode.ReservedFlag,
    ],
    ["--no-auth", { command: "doctor", options: { "no-auth": true } }, FREE, GenexCliRefusalCode.ReservedFlag],
    [
      "--api-url",
      { command: "doctor", options: { "api-url": "https://evil.example" } },
      FREE,
      GenexCliRefusalCode.ReservedFlag,
    ],
    ["--agents", { command: "doctor", options: { agents: "claude" } }, FREE, GenexCliRefusalCode.ReservedFlag],
    [
      "--force",
      { command: "shop remove", args: "sku_1", options: { force: true } },
      PAID,
      GenexCliRefusalCode.ReservedFlag,
    ],
    ["--json", { command: "doctor", options: { json: true } }, FREE, GenexCliRefusalCode.ReservedFlag],
    [
      "--schema, a file in Studio's folder",
      { command: "llm bench", args: "hi", options: { "max-coins": 5, schema: "a.json" } },
      PAID,
      GenexCliRefusalCode.UnknownOption,
    ],
    [
      "a dashed option name",
      { command: "llm models", options: { "--all": true } },
      FREE,
      GenexCliRefusalCode.UnknownOption,
    ],
    [
      "an option another command takes",
      { command: "doctor", options: { all: true } },
      FREE,
      GenexCliRefusalCode.UnknownOption,
    ],
    ["a positional of --force", { command: "llm cancel", args: "--force" }, FREE, GenexCliRefusalCode.InvalidValue],
    ["a positional with a newline", { command: "llm cancel", args: "a\nb" }, FREE, GenexCliRefusalCode.InvalidValue],
    ["a positional with a NUL", { command: "llm cancel", args: "a\u0000b" }, FREE, GenexCliRefusalCode.InvalidValue],
    [
      "an overlong positional",
      { command: "llm bench", args: "x".repeat(4001), options: { "max-coins": 5 } },
      PAID,
      GenexCliRefusalCode.InvalidValue,
    ],
    ["a positional to a command without one", { command: "doctor", args: "x" }, FREE, GenexCliRefusalCode.InvalidValue],
    ["a missing positional", { command: "llm cancel" }, FREE, GenexCliRefusalCode.InvalidValue],
    [
      "max-coins 1.5",
      { command: "llm bench", args: "hi", options: { "max-coins": 1.5 } },
      PAID,
      GenexCliRefusalCode.InvalidValue,
    ],
    [
      "max-coins 0",
      { command: "llm bench", args: "hi", options: { "max-coins": 0 } },
      PAID,
      GenexCliRefusalCode.InvalidValue,
    ],
    ["no max-coins", { command: "llm bench", args: "hi" }, PAID, GenexCliRefusalCode.InvalidValue],
    [
      "a text value starting with a dash",
      { command: "shop add", args: "Key", options: { price: 100, icon: "--env" } },
      PAID,
      GenexCliRefusalCode.InvalidValue,
    ],
    [
      "a type outside its choices",
      { command: "shop add", args: "Key", options: { price: 100, type: "rig" } },
      PAID,
      GenexCliRefusalCode.InvalidValue,
    ],
    [
      "a flag given a string",
      { command: "llm models", options: { all: "yes" } },
      FREE,
      GenexCliRefusalCode.InvalidValue,
    ],
    [
      "options that are not an object",
      { command: "llm models", options: ["all"] },
      FREE,
      GenexCliRefusalCode.InvalidValue,
    ],
    ["options that are not JSON", { command: "llm models", options: "{all" }, FREE, GenexCliRefusalCode.InvalidValue],
    ["a command that is not a string", { command: 7 }, FREE, GenexCliRefusalCode.Unavailable],
  ];
  for (const [name, args, tool, code] of rows) {
    it(`refuses ${name}`, () => assert.equal(refusal(args, tool).code, code));
  }
});

describe("the argv Studio runs", () => {
  it("runs doctor as it is, off any project", () => {
    assert.deepEqual(genexCliRequest({ command: "doctor" }, FREE), {
      command: GenexCliCommand.Doctor,
      argv: ["doctor"],
      project: false,
      paid: false,
    });
  });
  it("spells flags with dashes and values after them, in the order given", () => {
    const request = genexCliRequest({ command: " llm   models ", options: '{"all":true}' }, FREE);
    assert.deepEqual(request.argv, ["llm", "models", "--all"]);
    assert.equal(request.project, false);
  });
  it("adds --user-approved itself to a paid bench, after the whole-number max-coins", () => {
    const request = genexCliRequest(
      { command: "llm bench", args: "Say hi", options: { "max-coins": 5, samples: 3 } },
      PAID,
    );
    assert.deepEqual(request.argv, ["llm", "bench", "Say hi", "--max-coins", "5", "--samples", "3", "--user-approved"]);
    assert.equal(request.argv.at(-1), "--user-approved");
    assert.equal(request.project, true);
    assert.equal(request.paid, true);
  });
  it("binds project commands to the hosted project and leaves free ones unbound", () => {
    assert.equal(genexCliRequest({ command: "llm status" }, FREE).project, true);
    assert.equal(genexCliRequest({ command: "llm cancel", args: "gen_1" }, FREE).project, true);
    assert.equal(genexCliRequest({ command: "shop list" }, FREE).project, true);
    assert.equal(genexCliRequest({ command: "budget" }, FREE).project, false);
  });
  it("sets and clears a shop item's resale with the CLI's two flags", () => {
    assert.deepEqual(
      genexCliRequest({ command: "shop set", args: "sku_1", options: { resellable: false, price: 50 } }, PAID).argv,
      ["shop", "set", "sku_1", "--no-resellable", "--price", "50"],
    );
    assert.deepEqual(
      genexCliRequest(
        { command: "shop add", args: "Iron Key", options: { price: 100, type: "durable", resellable: true } },
        PAID,
      ).argv,
      ["shop", "add", "Iron Key", "--price", "100", "--type", "durable", "--resellable"],
    );
  });
  it("leaves out a flag that is false", () => {
    assert.deepEqual(genexCliRequest({ command: "llm models", options: { all: false } }, FREE).argv, ["llm", "models"]);
  });
});

describe("what the consent card shows for a paid call", () => {
  /** The card's text for `args`, the way the chat renders the durable record. */
  const card = (args: Record<string, unknown>) =>
    consentAskWords({
      pluginName: "Genex",
      tool: "genex__cli-paid",
      args: consentArgsDigest(genexCliConsentArgs(args, PAID)),
    });
  const longText = `Benchmark with max-coins 5. ${"x".repeat(2100)}`;
  const rows: Array<[string, Record<string, unknown>, RegExp]> = [
    [
      "a bench whose long prompt comes first",
      { command: "llm bench", args: longText, options: { model: "m".repeat(400), samples: 25, "max-coins": 250000 } },
      /max-coins: 250000/,
    ],
    [
      "a shop item whose long name comes first",
      { command: "shop add", args: "k".repeat(3000), options: { icon: "i".repeat(400), price: 9000 } },
      /price: 9000/,
    ],
    [
      "a price change behind a long rename",
      { command: "shop set", args: "sku_1", options: { rename: "r".repeat(400), price: 70 } },
      /price: 70/,
    ],
  ];
  for (const [name, args, spend] of rows) {
    it(`names what it spends first for ${name}`, () => {
      const text = card(args);
      assert.match(text, /command: (llm bench|shop add|shop set)/);
      assert.match(text, spend);
    });
  }
  it("never shows the agent's own words before the amount", () => {
    const text = card({ command: "llm bench", args: longText, options: { "max-coins": 250000 } });
    assert.ok(text.indexOf("max-coins: 250000") < text.indexOf("Benchmark"), text);
  });
  it("refuses before anyone is asked when Studio would refuse the call", () => {
    assert.throws(() => genexCliConsentArgs({ command: "llm bench", args: "hi" }, PAID), GenexCliRefusal);
    assert.throws(() => genexCliConsentArgs({ command: "shop list" }, PAID), GenexCliRefusal);
  });
});
