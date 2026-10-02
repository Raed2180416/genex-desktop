/**
 * Child process used by the atomicity drill: appends events as fast as it can until its parent
 * SIGKILLs it mid-write. Run as: node crash-writer.ts <root> <threadId>
 */
import { EventStore } from "../../src/substrate/event-store.ts";

const [, , root, threadId] = process.argv;
const store = await EventStore.open(root!, "studio");
if (threadId) {
  process.send?.({ ready: true });
  for (let i = 0; ; i++) {
    await store.appendEvents(threadId, [
      {
        type: "messages",
        // Big payload widens the window in which a kill can land mid-write.
        messages: [{ role: "user", content: `${i}:${"x".repeat(20_000)}` }],
      },
    ]);
    if (i === 0) process.send?.({ appending: true });
  }
}
