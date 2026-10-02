/**
 * Event log schema. The contract types live in `shared/event-log.ts` (the renderer and the harness
 * read them too); this module re-exports them next to the store-side records and errors.
 */
import { type EventData, type EventEnvelope, EventKind } from "../shared/event-log.ts";

export type {
  ConversationRecord,
  EventData,
  EventEnvelope,
  EventKind,
  Message,
  MessageImage,
  Role,
  SnapshotGitRefs,
  SnapshotScope,
  ToolCall,
  Usage,
} from "../shared/event-log.ts";

export interface AgentRecord {
  id: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactVersion<T = unknown> {
  artifact_id: string;
  version: number;
  created_at: string;
  value: T;
}

/** Thrown when an append's `expectedHead` no longer matches the stored head. */
export class HeadMismatch extends Error {
  readonly actual: string | null;
  readonly expected: string | null;
  constructor(actual: string | null, expected: string | null) {
    super(`head mismatch: store head is ${actual ?? "<empty>"}, caller expected ${expected ?? "<empty>"}`);
    this.name = "HeadMismatch";
    this.actual = actual;
    this.expected = expected;
  }
}

export class ThreadNotFound extends Error {
  constructor(threadId: string) {
    super(`thread not found: ${threadId}`);
    this.name = "ThreadNotFound";
  }
}

export function isMessagesEvent(
  e: EventEnvelope,
): e is EventEnvelope & { data: Extract<EventData, { type: typeof EventKind.Messages }> } {
  return e.data.type === EventKind.Messages;
}
