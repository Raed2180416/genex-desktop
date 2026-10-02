/**
 * The follow-up queue each conversation still owes an answer to, for the harness boot restore
 * (`events.inbox`). A boot used to read every conversation's whole log over stdio to find it;
 * the host keeps just the queue records that are still open and extends them from a cursor.
 * Derived and disposable: the log stays the truth. A launch seeds it from the boot repair's
 * fold (`RecoveryService.closeInterruptedWork`), so the harness boot after it reads next to nothing.
 */
import { customRecord } from "../../shared/custom-events.ts";
import { EventKind } from "../../shared/event-log.ts";
import { QUEUE_EVENTS, messageQueueState, type QueuedMessage, QueueState } from "../../shared/message-queue.ts";
import type { EventStore } from "../../substrate/event-store.ts";
import { compareIds } from "../../substrate/ids.ts";
import type { EventEnvelope } from "../../substrate/types.ts";

const QUEUE_RECORDS: ReadonlySet<string> = new Set(Object.values(QUEUE_EVENTS));
const GATE_RECORDS: ReadonlySet<string> = new Set([QUEUE_EVENTS.paused, QUEUE_EVENTS.resumed]);
/**
 * A message in one of these states still owes an answer. `steering`: handed to a turn a restart
 * cut short and not read, so the harness gives it a turn of its own.
 */
const OPEN_STATES: ReadonlySet<QueueState> = new Set<QueueState>([
  QueueState.Queued,
  QueueState.Processing,
  QueueState.Steering,
]);

type QueueRecordData = NonNullable<ReturnType<typeof customRecord>>;

/** One conversation's open queue records. */
export interface InboxEntry {
  threadId: string;
  events: EventEnvelope[];
}

/** A conversation's queue as far as its log was read. */
export interface InboxState {
  /** The last event read, when it carried a user's words: a queued record right after names it. */
  lastMessages: string | null;
  /** The queue records still open, oldest first. */
  records: EventEnvelope[];
}

/**
 * Fold new events into a conversation's open queue records. A queued record gets the id of the
 * user's words before it (`eventId`) written in, since those words are not kept; then every
 * record of a message that was answered or removed is dropped, and the last pause stays only
 * when nothing resumed the queue after it. Replaying what is left through
 * `messageQueueState` gives the open messages, and the pause, that the whole log gives.
 */
export function foldInbox(previous: InboxState | null, events: readonly EventEnvelope[]): InboxState {
  const records = [...(previous?.records ?? [])];
  let lastMessages = previous?.lastMessages ?? null;
  for (const event of events) {
    const custom = customRecord(event.data);
    if (custom && QUEUE_RECORDS.has(custom.event_type)) records.push(namedRecord(event, custom, lastMessages));
    lastMessages = event.data.type === EventKind.Messages ? event.id : null;
  }
  const open = openMessageIds(records);
  const lastGate = records.findLast((event) => GATE_RECORDS.has(customRecord(event.data)?.event_type ?? ""));
  const kept = records.filter((event) => {
    const custom = customRecord(event.data);
    if (!custom) return false;
    // A queue is running unless its last gate record paused it.
    if (GATE_RECORDS.has(custom.event_type)) return event === lastGate && custom.event_type === QUEUE_EVENTS.paused;
    const messageId = custom.payload.messageId;
    return isMessageId(messageId) && open.has(String(messageId));
  });
  return { lastMessages, records: kept };
}

/** A queue record as kept: a queued one without it gets the id of the user's words right before it. */
function namedRecord(event: EventEnvelope, custom: QueueRecordData, lastMessages: string | null): EventEnvelope {
  const { payload } = custom;
  const named = custom.event_type === QUEUE_EVENTS.queued && payload.eventId === undefined && lastMessages;
  if (!named) return event;
  return {
    ...event,
    data: {
      type: EventKind.Custom,
      event_type: custom.event_type,
      payload: { ...payload, eventId: lastMessages },
    },
  };
}

/**
 * The ids of the messages these records leave queued or in progress, and of those read by a turn
 * still in progress: they ride in its replay (the harness's `restore`).
 */
function openMessageIds(records: readonly EventEnvelope[]): Set<string> {
  const messages = [...messageQueueState(records).messages.values()];
  const open = new Set(messages.filter((m) => OPEN_STATES.has(m.state)).map((m) => m.messageId));
  // Read by a turn (steer): it is owed its answer while that turn is.
  const readByOpenTurn = (m: QueuedMessage): boolean => m.state === QueueState.Delivered && open.has(m.into ?? "");
  for (const m of messages) if (readByOpenTurn(m)) open.add(m.messageId);
  return open;
}

/** Is this a message id a queue record can carry? */
function isMessageId(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

export class InboxProjection {
  /** Each conversation's state, and the last event it covers. */
  readonly #threads = new Map<string, InboxState & { cursor: string }>();
  #serial: Promise<unknown> = Promise.resolve();

  /** Start a conversation from a state already folded through `cursor`. */
  seed(threadId: string, state: InboxState, cursor: string): void {
    this.#threads.set(threadId, { ...state, cursor });
  }

  /** Every conversation with open queue records, each brought up to its head first. */
  pending(store: EventStore): Promise<InboxEntry[]> {
    const next = this.#serial.then(async () => {
      const out: InboxEntry[] = [];
      const live = new Set<string>();
      for (const thread of await store.listThreads()) {
        const head = thread.latest_event_id;
        if (head === null) continue;
        live.add(thread.id);
        const known = await this.#atHead(store, thread.id, head);
        if (known.records.length > 0) out.push({ threadId: thread.id, events: known.records });
      }
      for (const id of this.#threads.keys()) if (!live.has(id)) this.#threads.delete(id);
      return out;
    });
    this.#serial = next.catch(() => {});
    return next;
  }

  /** One conversation's queue folded up to `head`: from its cursor, or afresh when the cursor is past it. */
  async #atHead(store: EventStore, threadId: string, head: string): Promise<InboxState & { cursor: string }> {
    const cached = this.#threads.get(threadId);
    const known = cached && compareIds(cached.cursor, head) > 0 ? undefined : cached;
    if (known && known.cursor === head) return known;
    const fresh = await store.listEvents(threadId, {
      ...(known ? { after: known.cursor } : {}),
      upToInclusive: head,
    });
    const folded = { ...foldInbox(known ?? null, fresh), cursor: head };
    this.#threads.set(threadId, folded);
    return folded;
  }
}

const projections = new WeakMap<EventStore, InboxProjection>();

/** The projection of this store's log: one per store, so the boot repair and the RPC share it. */
export function inboxOf(store: EventStore): InboxProjection {
  let projection = projections.get(store);
  if (!projection) {
    projection = new InboxProjection();
    projections.set(store, projection);
  }
  return projection;
}
