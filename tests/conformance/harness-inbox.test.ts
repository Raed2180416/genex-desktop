/**
 * The Windows host-to-harness channel, against the real bootstrap (no sandbox needed): srt-win
 * does not pass stdin through, so the bootstrap listens on a loopback port and takes commands only
 * from a client whose first line is the one-time token.
 */
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { cp } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { HarnessInbox } from "../../src/substrate/harness-inbox.ts";
import { tmpDir } from "../helpers/tmp.ts";

const BOOTSTRAP = fileURLToPath(new URL("../../src/harness-boot/bootstrap.mjs", import.meta.url));
const FIXTURE_OK = fileURLToPath(new URL("../fixtures/harness-ok", import.meta.url));
const WAIT_MS = 15_000;
const QUIET_MS = 500;

const children: ChildProcessWithoutNullStreams[] = [];
after(() => {
  for (const child of children) child.kill();
});

/** The bootstrap over a copy of the fixture harness, listening on `inbox`; resolves once ready. */
async function bootstrap(
  inbox: HarnessInbox,
): Promise<{ child: ChildProcessWithoutNullStreams; stdout: () => string }> {
  const workspace = path.join(await tmpDir("harness-inbox-"), "harness");
  await cp(FIXTURE_OK, workspace, { recursive: true });
  const child = spawn(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, HARNESS_WS: workspace, NODE_OPTIONS: "", ...inbox.env() },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  const deadline = Date.now() + WAIT_MS;
  while (!stdout.includes('"kind":"ready"') && Date.now() < deadline) await sleep(50);
  assert.match(stdout, /"kind":"ready"/, "the bootstrap booted");
  return { child, stdout: () => stdout };
}

const HEALTHCHECK = `${JSON.stringify({ kind: "dispatch", id: 7, action: { type: "healthcheck" } })}\n`;

/** A raw client of the inbox, once the bootstrap listens (it may print ready first). */
async function connectWhenListening(port: number): Promise<net.Socket> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const socket = await new Promise<net.Socket | null>((resolve) => {
      const attempt = net.connect(port, "127.0.0.1");
      attempt.once("connect", () => resolve(attempt));
      attempt.once("error", () => resolve(null));
    });
    if (socket) {
      socket.on("error", () => {});
      return socket;
    }
    assert.ok(Date.now() < deadline, "the bootstrap never listened");
    await sleep(50);
  }
}

async function until(check: () => boolean): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (!check() && Date.now() < deadline) await sleep(50);
  return check();
}

describe("the harness inbox", () => {
  it("answers commands from the host once the token is its first line", async () => {
    const inbox = await HarnessInbox.open();
    const harness = await bootstrap(inbox);
    inbox.write(HEALTHCHECK);
    assert.equal(await inbox.connect(() => harness.child.exitCode === null), true);
    // The fixture's healthcheck calls the host back (`events.head`): answer it over the inbox.
    assert.equal(await until(() => harness.stdout().includes('"kind":"rpc"')), true, harness.stdout());
    const rpc = harness
      .stdout()
      .split("\n")
      .map((line) => (line.includes('"kind":"rpc"') ? (JSON.parse(line) as { id: number }) : null))
      .find(Boolean);
    inbox.write(`${JSON.stringify({ kind: "rpc-result", id: rpc?.id, ok: true, value: null })}\n`);
    assert.equal(await until(() => harness.stdout().includes('"kind":"dispatch-result"')), true, harness.stdout());
    assert.match(harness.stdout(), /"id":7,"ok":true/);
    inbox.close();
  });

  it("drops a client with a wrong or missing token, and nothing it sends runs", async () => {
    for (const greeting of ["not-the-token\n", "\n", HEALTHCHECK]) {
      const inbox = await HarnessInbox.open();
      const harness = await bootstrap(inbox);
      const intruder = await connectWhenListening(inbox.port);
      const closed = new Promise<void>((resolve) => intruder.once("close", () => resolve()));
      intruder.write(`${greeting}${HEALTHCHECK}`);
      await closed;
      await sleep(QUIET_MS);
      assert.ok(!harness.stdout().includes("dispatch-result"), `${JSON.stringify(greeting)} got an answer`);
      assert.equal(await inbox.connect(() => harness.child.exitCode === null), true, "the host still gets in");
      inbox.close();
    }
  });

  it("refuses to listen without a token", async () => {
    const workspace = path.join(await tmpDir("harness-inbox-"), "harness");
    await cp(FIXTURE_OK, workspace, { recursive: true });
    const child = spawn(process.execPath, [BOOTSTRAP], {
      env: { ...process.env, HARNESS_WS: workspace, HARNESS_INBOX_PORT: "1", HARNESS_INBOX_TOKEN: "" },
    });
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(code, 6);
  });
});
