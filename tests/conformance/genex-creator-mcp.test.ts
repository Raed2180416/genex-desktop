import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CREATOR_ENDPOINT,
  CREATOR_TOOLS,
  createCreatorMcp,
  readCreatorCredential,
} from "../../src/plugins/genex/creator-mcp.ts";

const token = "fixture-secret-not-for-logs";
function peer() {
  const requests: Array<{ url: string; method?: string; body: any; headers: Headers; redirect?: RequestRedirect }> = [];
  let error = false,
    redirect = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      url: String(input),
      method: init?.method,
      body,
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
    });
    if (redirect) return new Response("", { status: 307, headers: { Location: "https://untrusted.invalid/mcp" } });
    if (error) throw new Error(`upstream leaked ${token}`);
    if (init?.method === "GET") return new Response("", { status: 405 });
    if (!body || body.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (body.method === "initialize")
      result = {
        protocolVersion: body.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "genex-test", version: "1" },
      };
    else if (body.method === "tools/list")
      result = {
        tools: [
          ...Object.keys(CREATOR_TOOLS),
          "generate",
          "credits",
          "setup_genex_tools",
          "publish_game",
          "future_paid_tool",
        ].map((name) => ({
          name,
          description: "Install npx to use this",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        })),
      };
    else
      result = {
        content: [{ type: "text", text: `${body.params.name}: ${token}` }],
        structuredContent: { credential: token },
      };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
  return {
    requests,
    fetchImpl,
    fail: () => {
      error = true;
    },
    redirect: () => {
      redirect = true;
    },
  };
}

test("main Genex MCP forwards discovery with the shared credential and keeps writes in host tools", async () => {
  const remote = peer();
  const bridge = await createCreatorMcp(token, remote.fetchImpl);
  const [local, hosted] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "studio-test", version: "1" });
  try {
    await bridge.server.connect(hosted);
    await client.connect(local);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((t) => t.name),
      Object.keys(CREATOR_TOOLS),
    );
    assert.equal(
      listed.tools[0]!.inputSchema.properties?.query &&
        (listed.tools[0]!.inputSchema.properties.query as { type: string }).type,
      "string",
    );
    assert.doesNotMatch(JSON.stringify(listed), /npx|fixture-secret/);
    for (const name of Object.keys(CREATOR_TOOLS)) {
      const result = await client.callTool({ name, arguments: { query: "fishing" } });
      assert.match(JSON.stringify(result), /redacted/);
      assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
    }
    const calls = remote.requests.filter((r) => r.body?.method === "tools/call").length;
    for (const name of ["generate", "credits", "setup_genex_tools", "publish_game", "future_paid_tool"]) {
      assert.equal((await client.callTool({ name, arguments: {} })).isError, true);
    }
    assert.equal(
      remote.requests.filter((r) => r.body?.method === "tools/call").length,
      calls,
      "no write/setup bypass even through a direct call",
    );
    for (const request of remote.requests) {
      assert.equal(request.url, CREATOR_ENDPOINT);
      assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
      assert.equal(request.redirect, "error");
    }
    remote.fail();
    await assert.rejects(client.listTools(), (error) => {
      assert.match(String(error), /Cannot list Genex/);
      assert.doesNotMatch(String(error), /fixture-secret/);
      return true;
    });
    const failed = await client.callTool({ name: "my_games", arguments: {} });
    assert.equal(failed.isError, true);
    assert.doesNotMatch(JSON.stringify(failed), /fixture-secret/);
  } finally {
    await client.close();
    await bridge.close();
  }
});

test("creator MCP refuses redirects and sanitizes connection errors", async () => {
  for (const mode of ["fail", "redirect"] as const) {
    const remote = peer();
    remote[mode]();
    await assert.rejects(createCreatorMcp(token, remote.fetchImpl), (error) => {
      assert.match(String(error), /Check your connection/);
      assert.doesNotMatch(String(error), /fixture-secret/);
      return true;
    });
    assert.ok(remote.requests.every((r) => r.url === CREATOR_ENDPOINT));
  }
});

test("creator MCP reads only a bounded host credential pipe", async () => {
  async function* chunks(text: string) {
    yield Buffer.from(text);
  }
  // Studio hands a `node` plugin server the bare token (PLG-4); the older env-file line still reads.
  assert.equal(await readCreatorCredential(chunks(token)), token);
  assert.equal(await readCreatorCredential(chunks("tok=with/symbols==")), "tok=with/symbols==");
  assert.equal(await readCreatorCredential(chunks(`GENEX_TOKEN=${token}\n`)), token);
  for (const text of ["", "\n", "GENEX_TOKEN=", "GENEX_TOKEN=first\nGENEX_TOKEN=second", "two words"]) {
    await assert.rejects(readCreatorCredential(chunks(text)), /Connect or unlock/);
  }
  await assert.rejects(readCreatorCredential(chunks("x".repeat(65_537))), /too large/);
});
