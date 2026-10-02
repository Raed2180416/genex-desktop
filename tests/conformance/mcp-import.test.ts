import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMcpSnippet } from "../../src/shared/mcp-import.ts";

test("a Claude-style stdio entry keeps env names on the connector and values in the secrets map", () => {
  const { drafts, warnings } = parseMcpSnippet(
    JSON.stringify({
      mcpServers: {
        Weather_API: {
          command: "/usr/local/bin/weather",
          args: ["--stdio"],
          cwd: "/tmp/weather",
          env: { WEATHER_TOKEN: "abc123", LOG_LEVEL: "debug" },
        },
      },
    }),
  );
  assert.equal(drafts.length, 1);
  const { connector, secrets } = drafts[0]!;
  assert.equal(connector.id, "weather-api");
  assert.equal(connector.name, "Weather_API");
  assert.equal(connector.transport, "stdio");
  assert.equal(connector.command, "/usr/local/bin/weather");
  assert.deepEqual(connector.args, ["--stdio"]);
  assert.equal(connector.cwd, "/tmp/weather");
  assert.deepEqual(connector.env, ["WEATHER_TOKEN", "LOG_LEVEL"]);
  assert.deepEqual(secrets, { "env.WEATHER_TOKEN": "abc123", "env.LOG_LEVEL": "debug" });
  assert.equal(JSON.stringify(connector).includes("abc123"), false, "a value never rides on the connector");
  assert.ok(warnings.some((w) => /stored encrypted/.test(w)));
});

test("http headers split the same way, and type:sse is honoured", () => {
  const { drafts } = parseMcpSnippet(
    JSON.stringify({
      mcpServers: {
        docs: {
          type: "http",
          url: "https://docs.example/mcp",
          headers: { Authorization: "Bearer t0ken", "X-Bad Header": "no" },
        },
        feed: { type: "sse", url: "https://feed.example/sse" },
      },
    }),
  );
  assert.deepEqual(
    drafts.map((d) => d.connector.transport),
    ["http", "sse"],
  );
  assert.deepEqual(drafts[0]!.connector.headers, ["Authorization"]);
  assert.deepEqual(drafts[0]!.secrets, { "header.Authorization": "Bearer t0ken" });
  assert.equal(drafts[0]!.connector.url, "https://docs.example/mcp");
  assert.equal(drafts[1]!.connector.url, "https://feed.example/sse");
  assert.equal(drafts[1]!.connector.headers, undefined);
});

test("the Codex TOML subset reads, and a bearer env var asks for the value instead of guessing it", () => {
  const { drafts, warnings } = parseMcpSnippet(
    [
      "# my codex config",
      'model = "gpt-5"',
      "[mcp_servers.local-tools]",
      'command = "npx"',
      'args = ["-y", "@example/tools"]',
      'env = { TOOLS_KEY = "sk-live", NOTES = "hi" }',
      "",
      "[mcp_servers.remote]",
      'url = "https://remote.example/mcp"',
      'bearer_token_env_var = "REMOTE_TOKEN"',
    ].join("\n"),
  );
  assert.deepEqual(
    drafts.map((d) => d.connector.id),
    ["local-tools", "remote"],
  );
  const local = drafts[0]!;
  assert.equal(local.connector.command, "npx");
  assert.deepEqual(local.connector.args, ["-y", "@example/tools"]);
  assert.deepEqual(local.connector.env, ["TOOLS_KEY", "NOTES"]);
  assert.deepEqual(local.secrets, { "env.TOOLS_KEY": "sk-live", "env.NOTES": "hi" });
  const remote = drafts[1]!;
  assert.equal(remote.connector.transport, "http");
  assert.deepEqual(remote.connector.headers, ["Authorization"]);
  assert.deepEqual(remote.secrets, {});
  assert.ok(warnings.some((w) => /REMOTE_TOKEN/.test(w) && /Authorization/.test(w)));
});

test("an env table written as its own TOML section is read too", () => {
  const { drafts } = parseMcpSnippet('[mcp_servers.x]\ncommand = "run"\n\n[mcp_servers.x.env]\nA_KEY = "value"\n');
  assert.deepEqual(drafts[0]!.connector.env, ["A_KEY"]);
  assert.deepEqual(drafts[0]!.secrets, { "env.A_KEY": "value" });
});

test("nothing in the paste box ever throws: every refusal is a warning", () => {
  for (const input of [
    "",
    "   ",
    "{oops",
    "[]",
    "null",
    '{"mcpServers":{"a":1}}',
    '{"mcpServers":{"a":{}}}',
    '{"mcpServers":{"___":{"command":"x"}}}',
    "random prose",
    "[mcp_servers.y]\n",
    undefined,
    42,
    "x".repeat(300_000),
  ]) {
    const result = parseMcpSnippet(input as unknown as string);
    assert.ok(Array.isArray(result.drafts), `drafts for ${String(input).slice(0, 20)}`);
    assert.ok(result.warnings.length > 0, `a warning for ${String(input).slice(0, 20)}`);
  }
  assert.deepEqual(parseMcpSnippet('{"mcpServers":{"a":{"command":"x"}}}').warnings, []);
});

test("import preserves spaced, comma-containing, empty and escaped arguments and reports unsupported settings", () => {
  const parsed = parseMcpSnippet(
    '[mcp_servers."docs.dev"]\ncommand = "node"\nargs = [\n "a path/server.mjs", # keep one argument\n "a,b", "", "quote\\\"inside",\n]\nenabled = false\nstartup_timeout_sec = 45\n',
  );
  assert.deepEqual(parsed.drafts[0]?.connector.args, ["a path/server.mjs", "a,b", "", 'quote"inside']);
  assert.equal(parsed.drafts[0]?.connector.enabled, false);
  assert.ok(parsed.warnings.some((w) => w.includes("startup_timeout_sec")));
  assert.equal(parseMcpSnippet('{"mcpServers":{"bad":{"command":"node","args":[1,"ok"]}}}').drafts.length, 0);
});

test("a ${VAR} placeholder is kept as a name that still needs its value, never stored as the secret (MCP-5)", () => {
  const { drafts, warnings } = parseMcpSnippet(
    JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@example/github"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}", ORG: "$ORG_NAME", LOG_LEVEL: "debug", PASS: "pa$$word" },
        },
        docs: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" } },
      },
    }),
  );
  const [github, docs] = drafts;
  assert.deepEqual(github!.connector.env, ["GITHUB_TOKEN", "ORG", "LOG_LEVEL", "PASS"], "every name is kept");
  assert.deepEqual(
    github!.secrets,
    { "env.LOG_LEVEL": "debug", "env.PASS": "pa$$word" },
    "only real values are stored",
  );
  assert.deepEqual(github!.needsValue, ["env.GITHUB_TOKEN", "env.ORG"]);
  assert.deepEqual(docs!.connector.headers, ["Authorization"]);
  assert.deepEqual(docs!.secrets, {});
  assert.deepEqual(docs!.needsValue, ["header.Authorization"]);
  assert.ok(warnings.some((w) => w.includes("GITHUB_TOKEN") && w.includes("${GITHUB_TOKEN}")));
  assert.ok(warnings.some((w) => w.includes("Authorization") && w.includes("${DOCS_TOKEN}")));
  assert.ok(
    warnings.some((w) => /github: 2 value\(s\) came with the snippet/.test(w)),
    "the stored count leaves the placeholders out",
  );
  assert.equal(
    warnings.some((w) => /docs: .* came with the snippet/.test(w)),
    false,
  );
});

test("the Codex TOML path treats placeholders the same way (MCP-5)", () => {
  const { drafts } = parseMcpSnippet('[mcp_servers.x]\ncommand = "run"\nenv = { API_KEY = "${API_KEY}" }\n');
  assert.deepEqual(drafts[0]!.secrets, {});
  assert.deepEqual(drafts[0]!.needsValue, ["env.API_KEY"]);
});

test("TOML sub-tables: a headers section is read, any other table is reported and skipped, and a broken value is a warning", () => {
  const { drafts, warnings } = parseMcpSnippet(
    [
      "[mcp_servers.web]",
      'url = "https://web.example/mcp"',
      'enabled_tools = ["search"]',
      "[mcp_servers.web.headers]",
      'X-Key = "abc"',
      "[mcp_servers.web.tools.extra]",
      'ignored = "yes"',
      "[mcp_servers.plain]",
      'command = "run" # a trailing comment',
    ].join("\n"),
  );
  assert.deepEqual(
    drafts.map((d) => d.connector.id),
    ["web", "plain"],
  );
  assert.deepEqual(drafts[0]?.connector.headers, ["X-Key"]);
  assert.deepEqual(drafts[0]?.connector.toolPolicy, { allow: ["search"] });
  assert.deepEqual(drafts[0]?.secrets, { "header.X-Key": "abc" });
  assert.equal(drafts[1]?.connector.command, "run");
  assert.ok(warnings.includes("web: table tools.extra is not imported."));
  assert.ok(!warnings.some((w) => w.includes("ignored")));
  for (const broken of [
    '[mcp_servers.a]\nargs = ["x",\n',
    '[mcp_servers.a]\ncommand = "x',
    "[mcp_servers.a]\nport = [1]",
  ])
    assert.match(parseMcpSnippet(broken).warnings[0] ?? "", /^Studio could not read that snippet: /);
});
