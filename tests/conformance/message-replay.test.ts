/**
 * A message that was being answered when the app quit: replay is the documented contract, but it
 * is bounded and said out loud. It is retried once with its attempt recorded; after a second
 * interruption it is settled, not replayed again. The boot notice says which of the two happens
 * instead of "Send a message to continue" above an automatic re-answer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageQueue, interruptedReplyNotice, messageQueueState } from "../../src/harness-seed/loop/message-queue.ts";

type Row = {
  id: string;
  thread_id: string;
  data: { type: string; event_type?: string; payload?: Record<string, unknown>; messages?: unknown[] };
};

function fixture(events: Row[] = []) {
  const host = {
    call: async (method: string, p: { threadId: string; batch: Row["data"][] }) => {
      if (method === "events.append")
        for (const data of p.batch)
          events.push({ id: String(events.length + 1).padStart(4, "0"), thread_id: p.threadId, data });
    },
    notify: () => {},
  };
  return { host, events };
}
const custom = (event_type: string, payload: Record<string, unknown>) => ({ type: "custom", event_type, payload });
const until = async (check: () => boolean) => {
  for (let n = 0; n < 1000; n++) {
    if (check()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail("queue did not settle");
};

/** The log a quit leaves behind: the message was received, then being answered. */
function interruptedOnce(): Row[] {
  const f = fixture();
  f.events.push({
    id: "0001",
    thread_id: "chat",
    data: { type: "messages", messages: [{ role: "user", content: "add a boss fight" }] },
  });
  f.events.push({
    id: "0002",
    thread_id: "chat",
    data: custom("coordinator_message_queued", {
      messageId: "boss",
      action: { type: "user_message", threadId: "chat", text: "add a boss fight" },
    }),
  });
  f.events.push({
    id: "0003",
    thread_id: "chat",
    data: custom("coordinator_message_processing", { messageId: "boss" }),
  });
  return f.events;
}

describe("replaying a message interrupted by a restart", () => {
  it("retries it once and records the attempt", async () => {
    const f = fixture(interruptedOnce());
    const seen: string[] = [];
    const queue = new MessageQueue(
      f.host as never,
      (async (action: { text: string }) => {
        seen.push(action.text);
      }) as never,
    );
    await queue.restore("chat", f.events as never);
    await until(() => messageQueueState(f.events as never).messages.get("boss")?.state === "handled");
    queue.stop();
    assert.deepEqual(seen, ["add a boss fight"]);
    const requeued = f.events.find((e) => e.data.event_type === "coordinator_message_requeued")!;
    assert.deepEqual(requeued.data.payload, { messageId: "boss", attempts: 1 });
    const processing = f.events.filter((e) => e.data.event_type === "coordinator_message_processing");
    assert.deepEqual(processing.at(-1)!.data.payload, { messageId: "boss", attempt: 2 });
  });

  it("does not replay it after a second interruption, and settles it as interrupted", async () => {
    const events = interruptedOnce();
    events.push({
      id: "0004",
      thread_id: "chat",
      data: custom("coordinator_message_requeued", { messageId: "boss", attempts: 1 }),
    });
    events.push({
      id: "0005",
      thread_id: "chat",
      data: custom("coordinator_message_processing", { messageId: "boss", attempt: 2 }),
    });
    events.push({
      id: "0006",
      thread_id: "chat",
      data: custom("coordinator_message_queued", {
        messageId: "later",
        action: { type: "user_message", threadId: "chat", text: "make it red" },
      }),
    });
    const f = fixture(events);
    const seen: string[] = [];
    const queue = new MessageQueue(
      f.host as never,
      (async (action: { text: string }) => {
        seen.push(action.text);
      }) as never,
    );
    await queue.restore("chat", f.events as never);
    await until(() => messageQueueState(f.events as never).messages.get("later")?.state === "handled");
    queue.stop();
    assert.deepEqual(seen, ["make it red"], "only the message still waiting replays");
    const settled = f.events.find(
      (e) => e.data.event_type === "coordinator_message_handled" && e.data.payload?.messageId === "boss",
    )!;
    assert.deepEqual(settled.data.payload, { messageId: "boss", interrupted: true, attempts: 2 });
  });

  it("the boot notice says whether Studio will retry the message", () => {
    assert.match(interruptedReplyNotice(interruptedOnce() as never)!, /Studio will retry this message/);
    const twice = [
      ...interruptedOnce(),
      {
        id: "0004",
        thread_id: "chat",
        data: custom("coordinator_message_requeued", { messageId: "boss", attempts: 1 }),
      },
      {
        id: "0005",
        thread_id: "chat",
        data: custom("coordinator_message_processing", { messageId: "boss", attempt: 2 }),
      },
    ];
    const notice = interruptedReplyNotice(twice as never)!;
    assert.doesNotMatch(notice, /will retry this message/);
    assert.match(notice, /Send it again/);
    assert.equal(interruptedReplyNotice([]), null, "no message was being answered: the caller keeps its own words");
  });
});
