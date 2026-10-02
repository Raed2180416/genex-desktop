import fs from "node:fs/promises";
import path from "node:path";
import { customRecord, CustomEvent } from "../../shared/custom-events.ts";
import { EventKind, type EventData } from "../../shared/event-log.ts";
import type { StudioCore } from "../studio-core.ts";
import { SHOT } from "./fixture-kit.ts";
import { largeBuildGraph } from "./fixture-large-graph-data.ts";

/** A repeatable thousand-step, five-worker graph for owned fixture profiles only. */
export async function seedLargeBuildGraph(core: StudioCore, project: string, threadId: string): Promise<void> {
  const fixture = largeBuildGraph();
  const seeded = (await core.store.listEvents(threadId)).some(
    (event) => customRecord(event.data)?.payload.runId === fixture.runId,
  );
  if (seeded) return;
  const runDir = path.join(core.layout.runs, fixture.runId);
  await fs.mkdir(runDir, { recursive: true });
  const shot = path.join(runDir, "fixture.jpg");
  await fs.writeFile(shot, SHOT);
  const lead = fixture.events
    .filter((event) => event.thread_id === "lead")
    .map((event): EventData => {
      const custom = customRecord(event.data);
      if (!custom) return event.data;
      return {
        type: EventKind.Custom,
        event_type: custom.event_type,
        payload: {
          ...custom.payload,
          project,
          ...(custom.event_type === CustomEvent.FacetIteration ? { shots: [{ camera: "default", path: shot }] } : {}),
        },
      };
    });
  await core.append(lead, threadId);
  for (const worker of fixture.threads) {
    const workerId = await core.store.createThread({ title: worker.title, metadata: { project } });
    const events = fixture.events.filter((event) => event.thread_id === worker.id).map((event) => event.data);
    await core.append(events, workerId);
  }
}
