/**
 * The eval stream collectors read the lane runner's receive-stamped streams into timeline events:
 * both stamp envelopes, a torn tail and a missing stamp; Claude's per-block duplicates collapse to
 * one call per message id with the final usage; tools pair with their results; sub-agent,
 * synthetic, compaction, retry and rate-limit lines land where they belong; Codex's cached tokens
 * come out of its input; `unwrapShell` sees through the shell wrapper; a vacuous stream throws.
 * Hermetic: synthetic fixtures under tests/fixtures/evals/collect, no provider.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { readClaudeStream } from "../../scripts/evals/collect/claude-stream.ts";
import { codexUsage, readCodexStream, unwrapShell } from "../../scripts/evals/collect/codex-stream.ts";
import {
  CollectError,
  CollectErrorCode,
  parseStampedStream,
  providerNoise,
  traceComplete,
} from "../../scripts/evals/collect/honesty.ts";
import type { ModelCallEvent, ObservationEvent, ToolCallEvent } from "../../scripts/evals/collect/observation.ts";
import type { StreamRecord } from "../../scripts/evals/lanes/common.ts";
import {
  EndedHow,
  LifecyclePhase,
  ObservationEventKind,
  ObservedErrorKind,
  PreviewSignal,
  ServedModelRole,
  ToolCategory,
} from "../../scripts/evals/vocabulary.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/evals/collect");
const PROMPT_AT = 1_790_000_000_000;
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const calls = (events: ObservationEvent[]) =>
  events.filter((e): e is ModelCallEvent => e.kind === ObservationEventKind.ModelCall);
const tools = (events: ObservationEvent[]) =>
  events.filter((e): e is ToolCallEvent => e.kind === ObservationEventKind.ToolCall);
const ofKind = (events: ObservationEvent[], kind: ObservationEvent["kind"]) => events.filter((e) => e.kind === kind);

describe("receive-stamped stream lines", () => {
  it("accepts the inline receivedAt field (epoch ms or ISO) and the lane's {receivedAt, line} record", () => {
    const record: StreamRecord = { receivedAt: 9, line: JSON.stringify({ type: "c" }) };
    const text = [
      JSON.stringify({ receivedAt: 5, type: "a" }),
      JSON.stringify({ receivedAt: "1970-01-01T00:00:00.007Z", type: "b" }),
      JSON.stringify(record),
      "",
    ].join("\n");
    const read = parseStampedStream(text);
    assert.deepEqual(
      read.lines.map((line) => [line.receivedAtMs, line.event.type, "receivedAt" in line.event]),
      [
        [5, "a", false],
        [7, "b", false],
        [9, "c", false],
      ],
    );
    assert.equal(read.parseFailures, 0);
    assert.equal(read.partialTail, false);
  });

  it("counts a torn final line as a truncated tail and any other bad line as a parse failure", () => {
    const text = `${JSON.stringify({ receivedAt: 1, type: "a" })}\nnot json\n${JSON.stringify({ receivedAt: 2, line: "{bad" })}\n{"receivedAt":3,"ty`;
    const read = parseStampedStream(text);
    assert.equal(read.lines.length, 1);
    assert.equal(read.parseFailures, 2);
    assert.equal(read.partialTail, true);
  });

  it("refuses a JSON line without a receive stamp: that is the lane runner's bug (Rule 12)", () => {
    for (const line of [{ type: "a" }, { receivedAt: "not a time", type: "a" }, { receivedAt: null, line: "{}" }]) {
      assert.throws(
        () => parseStampedStream(`${JSON.stringify(line)}\n`),
        (error: unknown) => error instanceof CollectError && error.code === CollectErrorCode.MissingReceiveStamp,
      );
    }
  });
});

describe("trace completeness and provider noise", () => {
  const clean = { parseFailures: 0, partialTail: false, sawTerminal: true };
  const cut = { parseFailures: 0, partialTail: false, sawTerminal: false };
  const rows: Array<[string, EndedHow, (typeof clean)[], { parseFailures: number; truncatedTail: boolean }]> = [
    ["finished with a result line", EndedHow.AgentFinished, [clean], { parseFailures: 0, truncatedTail: false }],
    ["finished without one", EndedHow.AgentFinished, [cut], { parseFailures: 0, truncatedTail: true }],
    ["max turns without one", EndedHow.MaxTurns, [cut], { parseFailures: 0, truncatedTail: true }],
    ["our deadline rail cut it", EndedHow.Deadline, [cut], { parseFailures: 0, truncatedTail: false }],
    [
      "a torn line under any ending",
      EndedHow.Deadline,
      [{ ...cut, partialTail: true }],
      { parseFailures: 0, truncatedTail: true },
    ],
    [
      "parse failures add up",
      EndedHow.Crash,
      [
        { ...clean, parseFailures: 2 },
        { ...clean, parseFailures: 1 },
      ],
      { parseFailures: 3, truncatedTail: false },
    ],
  ];
  for (const [name, endedHow, readings, expected] of rows) {
    it(name, () => assert.deepEqual(traceComplete(readings, endedHow), expected));
  }

  it("counts typed provider errors and retries, never tool errors", () => {
    const base = { atMs: 0, source: "stream" as const, session: null };
    const noise = providerNoise([
      { ...base, kind: ObservationEventKind.Error, error: ObservedErrorKind.ApiError, httpStatus: 529 },
      { ...base, kind: ObservationEventKind.Error, error: ObservedErrorKind.RateLimited, httpStatus: null },
      { ...base, kind: ObservationEventKind.Error, error: ObservedErrorKind.ToolError, httpStatus: 500 },
      { ...base, kind: ObservationEventKind.Retry, attempt: 1 },
    ]);
    assert.deepEqual(noise, { apiErrors: 2, retries: 1, apiErrorStatus: 529 });
  });
});

describe("Claude stream", () => {
  const read = readClaudeStream(fixture("claude-stream.jsonl"), PROMPT_AT);

  it("reads system/init: main-loop model, tools, MCP servers, skills and CLI version", () => {
    assert.equal(read.servedMain, "claude-opus-5-5");
    assert.equal(read.cliVersion, "2.1.284");
    assert.equal(read.sessionId, "sess-main");
    assert.deepEqual(read.init?.mcpServers, ["playwright"]);
    assert.deepEqual(read.init?.skills, ["example-skill"]);
    assert.deepEqual(read.init?.tools, ["Bash", "Edit", "Read", "Task"]);
  });

  it("counts one call per message id, keeps each field's maximum, and skips synthetic notes", () => {
    const byId = new Map(calls(read.events).map((call) => [call.id, call]));
    assert.deepEqual([...byId.keys()].sort(), ["msg_1", "msg_2", "msg_3", "msg_4", "msg_5", "msg_6", "msg_sub1"]);
    const first = byId.get("msg_1");
    assert.equal(first?.usage.output, 150);
    assert.equal(first?.atMs, 2000);
    assert.equal(first?.endMs, 2100);
    assert.equal(first?.contextTokens, 6002);
    assert.equal(first?.contextWindow, 1_000_000);
  });

  it("puts sub-agent messages in their own session under the Task call", () => {
    const sub = calls(read.events).find((call) => call.id === "msg_sub1");
    assert.deepEqual(sub?.session, {
      sessionId: "toolu_task",
      parentSessionId: "sess-main",
      role: ServedModelRole.Subagent,
    });
    assert.equal(calls(read.events).find((call) => call.id === "msg_2")?.session.role, ServedModelRole.Main);
  });

  it("pairs every tool call with its result, classifies it, and marks the look-at-page preview", () => {
    const byId = new Map(tools(read.events).map((tool) => [tool.id, tool]));
    assert.deepEqual(
      [...byId.values()].map((tool) => [tool.id, tool.category, tool.atMs, tool.endMs, tool.ok]),
      [
        ["toolu_1", ToolCategory.Edit, 2100, 3000, true],
        ["toolu_2", ToolCategory.Edit, 5000, 5200, false],
        ["toolu_3", ToolCategory.Build, 7000, 9000, true],
        ["toolu_task", ToolCategory.Subagent, 9500, 12000, true],
        ["toolu_s1", ToolCategory.Read, 10000, 10500, true],
        ["toolu_5", ToolCategory.Browser, 13000, 15000, true],
      ],
    );
    const previews = ofKind(read.events, ObservationEventKind.PreviewSignal);
    assert.deepEqual(
      previews.map((event) => [event.atMs, "signal" in event && event.signal]),
      [[13000, PreviewSignal.LookAtPage]],
    );
  });

  it("reads the result line: main-loop usage with thinking, per-model usage, cost, turns and ending", () => {
    assert.deepEqual(read.streamTokens, {
      uncachedInput: 12,
      cacheWrite: 1690,
      cacheRead: 25900,
      output: 385,
      reasoning: 100,
    });
    assert.deepEqual(Object.keys(read.modelUsage).sort(), ["claude-haiku-4-5-20251001", "claude-opus-5-5"]);
    assert.equal(read.modelUsage["claude-haiku-4-5-20251001"]?.usage.uncachedInput, 900);
    assert.equal(read.cliReportedUsd, 0.5);
    assert.deepEqual(read.results, [
      {
        subtype: "success",
        isError: false,
        terminalReason: "completed",
        numTurns: 6,
        durationMs: 17000,
        durationApiMs: 12000,
        apiErrorStatus: null,
        permissionDenials: 0,
        totalCostUsd: 0.5,
      },
    ]);
    assert.deepEqual(read.trace, { parseFailures: 0, partialTail: false, sawTerminal: true });
    assert.equal(read.lastAtMs, 17000);
  });

  it("keys a model's totals without Claude Code's context tag, so its bare calls find their window", () => {
    const tagged = fixture("claude-stream.jsonl").replace('"claude-opus-5-5":{', '"claude-opus-5-5[1m]":{');
    const reading = readClaudeStream(tagged, PROMPT_AT);
    assert.deepEqual(Object.keys(reading.modelUsage).sort(), ["claude-haiku-4-5-20251001", "claude-opus-5-5"]);
    assert.equal(reading.modelUsage["claude-opus-5-5"]?.contextWindow, 1_000_000);
    assert.equal(calls(reading.events).find((call) => call.id === "msg_1")?.contextWindow, 1_000_000);
  });

  it("records the compaction, the retry and the idle mark; an allowed rate-limit line is not an error", () => {
    assert.deepEqual(
      ofKind(read.events, ObservationEventKind.Compaction).map((e) => e.atMs),
      [12500],
    );
    assert.deepEqual(
      ofKind(read.events, ObservationEventKind.Retry).map((e) => e.atMs),
      [3500],
    );
    assert.deepEqual(ofKind(read.events, ObservationEventKind.Error), []);
    const idle = ofKind(read.events, ObservationEventKind.Lifecycle);
    assert.deepEqual(
      idle.map((e) => "phase" in e && e.phase),
      [LifecyclePhase.Idle],
    );
  });

  it("types an API error status and a refused rate limit from their fields", () => {
    const text = [
      { receivedAt: PROMPT_AT + 10, type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
      {
        receivedAt: PROMPT_AT + 20,
        type: "result",
        subtype: "error_during_execution",
        api_error_status: 429,
        usage: {},
      },
      {
        receivedAt: PROMPT_AT + 30,
        type: "result",
        subtype: "error_during_execution",
        api_error_status: 401,
        usage: {},
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");
    const errors = ofKind(readClaudeStream(text, PROMPT_AT).events, ObservationEventKind.Error);
    assert.deepEqual(
      errors.map((e) => ("error" in e ? [e.error, e.httpStatus] : null)),
      [
        [ObservedErrorKind.RateLimited, null],
        [ObservedErrorKind.RateLimited, 429],
        [ObservedErrorKind.AuthExpired, 401],
      ],
    );
  });

  it("throws when assistant lines yield no model call (the vacuity guard)", () => {
    const text = `${JSON.stringify({ receivedAt: PROMPT_AT, type: "assistant", message: { content: [] } })}\n`;
    assert.throws(
      () => readClaudeStream(text, PROMPT_AT),
      (error: unknown) => error instanceof CollectError && error.code === CollectErrorCode.VacuousModelCalls,
    );
  });

  it("reports a stream cut before its result line as having no terminal record", () => {
    const text = fixture("claude-stream.jsonl").split("\n").slice(0, 5).join("\n");
    const cut = readClaudeStream(text, PROMPT_AT);
    assert.equal(cut.trace.sawTerminal, false);
    assert.equal(cut.streamTokens, null);
  });
});

describe("Codex stream", () => {
  const read = readCodexStream(fixture("codex-stream.jsonl"), PROMPT_AT);

  it("takes cached tokens out of input and keeps reasoning inside output (Rule 13)", () => {
    assert.deepEqual(read.streamTokens, {
      uncachedInput: 10000,
      cacheWrite: 0,
      cacheRead: 40000,
      output: 1200,
      reasoning: 300,
    });
    assert.deepEqual(codexUsage({ input_tokens: 5, cached_input_tokens: 9, output_tokens: 1 }), {
      uncachedInput: 0,
      cacheWrite: 0,
      cacheRead: 9,
      output: 1,
      reasoning: 0,
    });
  });

  it("turns tool items into paired, classified tool calls in the main thread", () => {
    assert.equal(read.sessionId, "thr-main");
    assert.deepEqual(
      tools(read.events).map((tool) => [tool.id, tool.name, tool.category, tool.atMs, tool.endMs, tool.ok]),
      [
        ["item_1", "command_execution", ToolCategory.Install, 1200, 4200, true],
        ["item_2", "file_change", ToolCategory.Edit, 5000, 5100, true],
        ["item_3", "command_execution", ToolCategory.Build, 6000, 9000, false],
        ["item_4", "mcp__playwright__browser_navigate", ToolCategory.Browser, 9500, 9600, false],
        ["item_5", "command_execution", ToolCategory.Browser, 10000, 12000, true],
        ["item_6", "web_search", ToolCategory.Web, 12500, 12500, true],
        ["item_7", "todo_list", ToolCategory.Planning, 12600, null, null],
      ],
    );
    assert.ok(tools(read.events).every((tool) => tool.session.sessionId === "thr-main"));
    assert.deepEqual(calls(read.events), []);
  });

  it("records the preview, the typed error and the idle mark, and knows it ended", () => {
    const preview = ofKind(read.events, ObservationEventKind.PreviewSignal);
    assert.deepEqual(
      preview.map((e) => e.atMs),
      [10000],
    );
    const errors = ofKind(read.events, ObservationEventKind.Error);
    assert.deepEqual(
      errors.map((e) => ("error" in e ? e.error : null)),
      [ObservedErrorKind.ApiError],
    );
    assert.equal(read.trace.sawTerminal, true);
    assert.equal(read.servedMain, null);
  });

  it("unwraps the shell wrapper Codex reports around every command", () => {
    const rows: Array<[string, string]> = [
      ["/bin/zsh -lc 'npm run build'", "npm run build"],
      ['/bin/zsh -c "echo \\"hi\\" > out.txt"', 'echo "hi" > out.txt'],
      ["bash -lc 'it'\\''s here'", "it's here"],
      ["sh -c ls", "sh -c ls"],
      ["npm test", "npm test"],
    ];
    for (const [wrapped, command] of rows) assert.equal(unwrapShell(wrapped), command, wrapped);
  });
});
