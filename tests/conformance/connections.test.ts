/**
 * The tool registry's applied record, per thread, engine and session: what plugins and skills a
 * builder session was last handed once it answered. It is read back from the thread's log, so it
 * outlives the app, and a record that carries no set (a revision alone, a local model's
 * completion) never erases one that does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConnectionService } from "../../src/main/core/connections.ts";
import { CustomEvent } from "../../src/shared/custom-events.ts";
import { EventKind } from "../../src/shared/event-log.ts";
import { EventStore } from "../../src/substrate/event-store.ts";
import { tmpDir } from "../helpers/tmp.ts";

type ConnectionsCore = ConstructorParameters<typeof ConnectionService>[0];

/** A ConnectionService over `store`: only the log is real, since only the log is read back. */
function service(store: EventStore): ConnectionService {
  const core = {
    store,
    append: async (batch: Parameters<EventStore["appendEvents"]>[1], threadId: string) => {
      await store.appendEvents(threadId, batch);
      return "";
    },
    emit: () => {},
  } as unknown as ConnectionsCore;
  return new ConnectionService(core, () => false);
}

const BLENDER = { plugins: ["blender"], skills: ["blender/local-modeling"] };

test("a session's delivered plugins and skills are read back from its thread's log after a restart", async () => {
  const root = await tmpDir("connections-");
  const first = await EventStore.open(root);
  const threadId = await first.createThread();
  const before = service(first);
  await before.recordDelivered(threadId, "claude-code", "ses1", BLENDER);
  await before.recordDelivered(threadId, "codex", "ses1", { plugins: [], skills: [] });
  await before.recordApplied(threadId, "local", 3);

  const after = service(await EventStore.open(root));
  assert.deepEqual(await after.lastApplied(threadId, "claude-code", "ses1"), BLENDER);
  assert.deepEqual(await after.lastApplied(threadId, "codex", "ses1"), { plugins: [], skills: [] }, "per engine");
  assert.equal(await after.lastApplied(threadId, "local", "ses1"), undefined, "a revision record is no set");

  await after.recordApplied(threadId, "claude-code", 4);
  assert.deepEqual(await after.lastApplied(threadId, "claude-code", "ses1"), BLENDER, "and never erases a known one");
  await after.recordDelivered(threadId, "claude-code", "ses2", { plugins: [], skills: [] });
  assert.deepEqual(await after.lastApplied(threadId, "claude-code", "ses1"), BLENDER, "another session keeps its own");
  await after.recordDelivered(threadId, "claude-code", "ses1", { plugins: [], skills: [] });
  assert.deepEqual(
    await after.lastApplied(threadId, "claude-code", "ses1"),
    { plugins: [], skills: [] },
    "the session's newest set wins",
  );
});

test("malformed applied records in a log are ignored, never folded into a set", async () => {
  const store = await EventStore.open(await tmpDir("connections-hostile-"));
  const threadId = await store.createThread();
  const applied = (payload: unknown) => ({
    type: EventKind.Custom,
    event_type: CustomEvent.ToolRegistryApplied,
    payload,
  });
  await service(store).recordDelivered(threadId, "claude-code", "ses", BLENDER);
  await store.appendEvents(threadId, [
    applied({ engine: "claude-code", session: "ses", plugins: "blender" }),
    applied({ engine: "claude-code", session: "ses", plugins: [7], skills: [] }),
    applied({ engine: "claude-code", session: "ses", plugins: [], skills: [null] }),
    applied({ engine: "claude-code", plugins: [], skills: [] }),
    applied({ engine: "claude-code", session: 7, plugins: [], skills: [] }),
    applied({ engine: 42, session: "ses", plugins: [], skills: [] }),
    applied({ engine: "__proto__", session: "__proto__", plugins: ["x"], skills: [] }),
    applied(null),
  ] as never);
  const reader = service(store);
  assert.deepEqual(await reader.lastApplied(threadId, "claude-code", "ses"), BLENDER);
  // An engine or session name is only a key: `__proto__` is kept as a name like any other and reaches no prototype.
  assert.deepEqual(await reader.lastApplied(threadId, "__proto__", "__proto__"), { plugins: ["x"], skills: [] });
  assert.equal(await reader.lastApplied(threadId, "toString", "ses"), undefined);
  assert.equal(await reader.lastApplied(threadId, "codex", "ses"), undefined);
});
