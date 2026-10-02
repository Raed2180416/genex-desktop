import type { EventEnvelope } from "../types.ts";
import { delegatedPayload } from "../../shared/custom-events.ts";
import { SessionActivityRole } from "../../shared/chat-activity.ts";
import { EventKind } from "../../shared/event-log.ts";

/** The durable row may arrive before the stream acknowledgement or the idle status. */
export function replyCommitted(
  stream: { text: string; after?: string; committedId?: string },
  events: EventEnvelope[],
): boolean {
  return events.some((event) => {
    if (stream.committedId === event.id) return true;
    if (!stream.after || event.id <= stream.after) return false;
    const data = event.data;
    if (data.type === EventKind.Messages)
      return data.messages.some(
        (message) => message.role === "assistant" && message.content.trim() === stream.text.trim(),
      );
    const payload = delegatedPayload(data)?.payload;
    if (!payload) return false;
    const plannerReply =
      payload.kind === "assistant" && (!payload.role || payload.role === SessionActivityRole.Planner);
    if (!plannerReply) return false;
    const text = payload.data?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    return Boolean(text?.trim() && text.trim() === stream.text.trim());
  });
}
