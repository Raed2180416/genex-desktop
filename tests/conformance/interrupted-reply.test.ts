/**
 * The boot repair's notice for a reply a restart cut off is truthful about what happens next: a
 * message that was being answered is retried by the harness, so the chat must not also tell the
 * user to send a message (a follow-up would queue behind the replay and do the work twice).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { StudioCore } from "../../src/main/studio-core.ts";
import { TurnFactory } from "../../src/substrate/turns.ts";
import { makeFakePreview, makeResources } from "../helpers/studio-rig.ts";
import { startFakeOllama, type FakeOllama } from "../helpers/fake-ollama.ts";
import { tmpDir } from "../helpers/tmp.ts";

let server: FakeOllama | null = null;
const cores: StudioCore[] = [];
after(async () => {
  await Promise.all(cores.map((core) => core.stop().catch(() => {})));
  await server?.close();
});

async function makeCore(userData: string, resources: string): Promise<StudioCore> {
  server ??= await startFakeOllama({ replies: [] });
  const core = new StudioCore({
    paths: { userData, resources },
    preview: makeFakePreview(),
    execPath: process.execPath,
    ollamaHost: server.host,
  });
  cores.push(core);
  await core.init();
  return core;
}

describe("a reply cut off by a restart", () => {
  it("tells the user Studio will retry the message it was answering", async () => {
    const userData = path.join(await tmpDir("studio-interrupted-reply-"), "userData");
    const resources = await makeResources();
    const before = await makeCore(userData, resources);
    const threadId = await before.store.createThread({ title: "cut off" });
    await before.store.appendEvents(threadId, [
      { type: "messages", messages: [{ role: "user", content: "add a boss fight" }] },
      {
        type: "custom",
        event_type: "coordinator_message_queued",
        payload: { messageId: "boss", action: { type: "user_message", threadId, text: "add a boss fight" } },
      },
      { type: "custom", event_type: "coordinator_message_processing", payload: { messageId: "boss" } },
    ]);
    await new TurnFactory(before.store).beginTurn(threadId, { input: [{ role: "user", content: "add a boss fight" }] });
    await before.stop();

    const reborn = await makeCore(userData, resources);
    await reborn.start();
    const notices = (await reborn.store.listEvents(threadId)).flatMap((e) =>
      e.data.type === "error" ? [e.data.message] : [],
    );
    const closure = notices.find((m) => /interrupted by a restart/i.test(m));
    assert.ok(closure, JSON.stringify(notices));
    assert.match(closure, /Studio will retry this message/);
    assert.doesNotMatch(closure, /send a message to continue/i);
    await reborn.stop();
  });
});
