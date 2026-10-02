/**
 * After a restart a connector's saved secrets stay in the store until the user presses Connect
 * (review MCP-1). Until then nothing may start the connector without them, and Connect must hand
 * the next process the values it just unlocked instead of keeping the one that never had them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpConnector } from "../../src/shared/mcp.ts";
import { McpConnection } from "../../src/substrate/mcp/client.ts";
import { McpRegistry } from "../../src/substrate/mcp/registry.ts";
import { McpSessionSecrets } from "../../src/substrate/mcp/session-secrets.ts";
import { memorySecretPort, type SecretPort } from "../../src/substrate/mcp/store.ts";
import { toolchain } from "../../src/substrate/toolchain.ts";
import { createHash } from "node:crypto";

/** How the fixture reports a secret it received: a fingerprint, so the host has nothing to redact. */
const fingerprint = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

const SERVER = path.resolve("tests/fixtures/mcp/echo-server.mjs");
const connector = (overrides: Partial<McpConnector> = {}): McpConnector =>
  ({
    id: "echo",
    name: "Echo",
    transport: "stdio",
    command: process.execPath,
    args: [SERVER, "--env", "API_TOKEN"],
    env: ["API_TOKEN"],
    enabled: true,
    scope: "global",
    toolPolicy: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }) as McpConnector;

/** A connector saved with its token in one session, then the app relaunched: same file, same store, empty lease. */
async function restarted() {
  // The launch PATH without asking this machine's login shell; Connect asks it again, as in the app.
  await toolchain({ loginPath: async () => null });
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-mcp-lock-"));
  const file = path.join(root, "mcp", "connectors.json");
  const values = new Map<string, string>();
  const before = new McpRegistry({ file, secrets: memorySecretPort(values) });
  await before.init();
  await before.save(connector(), { "env.API_TOKEN": "tok-saved" }, { trust: true });
  assert.equal(
    await before.tool("echo__env_digest", {}, { project: "alpha" }),
    `API_TOKEN ${fingerprint("tok-saved")}`,
    "the first session hands the child its token",
  );
  await before.close();
  const registry = new McpRegistry({ file, secrets: memorySecretPort(values) });
  await registry.init();
  return {
    registry,
    values,
    async close() {
      await registry.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("after a restart, a delegation before Connect starts nothing, and Connect hands the child its saved secret", async () => {
  const f = await restarted();
  try {
    // A delegation starts before the user presses Connect.
    await f.registry.toolsFor("alpha");
    const connected = await f.registry.connect("echo", "alpha", async () => {});
    assert.equal(connected.ok, true, connected.error);
    assert.equal(
      await f.registry.tool("echo__env_digest", {}, { project: "alpha" }),
      `API_TOKEN ${fingerprint("tok-saved")}`,
    );
  } finally {
    await f.close();
  }
});

test("a connector whose secrets are still locked is listed as locked, never started for a delegation, a Test or Edit", async () => {
  const f = await restarted();
  try {
    assert.deepEqual(
      await f.registry.toolsFor("alpha"),
      [],
      "no tools from a connector that would run without its token",
    );
    const view = (await f.registry.list())[0]!;
    assert.match(String(view.error), /locked.*Connect/i, "and the card says what to do");
    assert.notEqual(view.health, "ready");
    await assert.rejects(f.registry.tool("echo__env", {}, { project: "alpha" }), /locked|Unknown connector tool/i);
    const tested = await f.registry.test("echo");
    assert.equal(tested.ok, false);
    assert.match(String(tested.error), /locked/i);
    await assert.rejects(f.registry.tools("echo"), /locked/i);
    // Connect is the one explicit unlock, and after it everything runs with the value.
    assert.equal((await f.registry.connect("echo", "alpha", async () => {})).ok, true);
    assert.deepEqual((await f.registry.toolsFor("alpha")).map((t) => t.name).includes("echo__env"), true);
    assert.equal((await f.registry.test("echo")).ok, true);
  } finally {
    await f.close();
  }
});

/** A saved connector and a registry over `secrets`, as after a relaunch. */
async function relaunched(
  secrets: (values: Map<string, string>) => SecretPort,
  overrides: Partial<McpConnector> = {},
  resolveProject?: (project: string) => Promise<string>,
) {
  await toolchain({ loginPath: async () => null });
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-mcp-lock-"));
  const file = path.join(root, "mcp", "connectors.json");
  const values = new Map<string, string>();
  const setup = new McpRegistry({ file, secrets: memorySecretPort(values) });
  await setup.init();
  await setup.save(connector(overrides), { "env.API_TOKEN": "tok-saved" }, { trust: true });
  await setup.close();
  const registry = new McpRegistry({ file, secrets: secrets(values), ...(resolveProject ? { resolveProject } : {}) });
  await registry.init();
  return {
    registry,
    async close() {
      await registry.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Connect replaces a process that started without its secret, and the new child has it (TQ-2)", async () => {
  // The store answers nothing the first time it is asked (a Keychain prompt dismissed), and the value after.
  let reads = 0;
  const f = await relaunched((values) => ({
    ...memorySecretPort(values),
    async get(key) {
      return ++reads === 1 ? null : (values.get(key) ?? null);
    },
  }));
  try {
    assert.equal((await f.registry.connect("echo", "alpha", async () => {})).ok, true);
    assert.equal(
      await f.registry.tool("echo__env_digest", {}, { project: "alpha" }),
      "API_TOKEN unset",
      "the first child really runs without it",
    );
    assert.equal((await f.registry.connect("echo", "alpha", async () => {})).ok, true);
    assert.equal(
      await f.registry.tool("echo__env_digest", {}, { project: "alpha" }),
      `API_TOKEN ${fingerprint("tok-saved")}`,
      "Connect again reads the store and restarts the child with the value",
    );
  } finally {
    await f.close();
  }
});

test("a locked connector is not even given its project folder before Connect (TQ-2)", async () => {
  const resolved: string[] = [];
  const f = await relaunched(memorySecretPort, { shareProjectRoot: true }, async (project) => {
    resolved.push(project);
    return os.tmpdir();
  });
  try {
    assert.deepEqual(await f.registry.toolsFor("alpha"), []);
    await assert.rejects(f.registry.tools("echo"), /locked/i);
    assert.equal((await f.registry.test("echo")).ok, false);
    assert.deepEqual(resolved, [], "nothing was prepared for a connector that may not start");
    assert.equal((await f.registry.connect("echo", "alpha", async () => {})).ok, true);
    assert.deepEqual(resolved, ["alpha"]);
  } finally {
    await f.close();
  }
});

test("a connection handed a locked session lease fails instead of starting the server with the secret missing", async () => {
  const values = new Map([["mcp.echo.env.API_TOKEN", "tok-saved"]]);
  const secrets = new McpSessionSecrets(memorySecretPort(values));
  const connection = new McpConnection({ connector: connector(), secrets });
  try {
    await assert.rejects(connection.listTools(), /locked/i);
    assert.equal(connection.pid, null, "no child was left running");
    assert.equal(await secrets.unlock(connector()), true, "the unlock loaded a value the lease did not have");
    assert.equal(await secrets.unlock(connector()), false, "and a second unlock loads nothing new");
    assert.equal(await connection.callTool("env_digest", {}), `API_TOKEN ${fingerprint("tok-saved")}`);
  } finally {
    await connection.close();
  }
});
