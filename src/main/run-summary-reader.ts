import { compareIds } from "../shared/compare-ids.ts";
import type { EventStore } from "../substrate/event-store.ts";
import type { EventEnvelope } from "../substrate/types.ts";

/** Projects whose histories stay cached; opening another forgets the least recently opened. */
const CACHED_PROJECTS = 4;

/** One thread's history as last read, and the head it was read up to. */
interface CachedThread {
  head: string | null;
  events: EventEnvelope[];
}

/** The cached head a read may continue from: only a head the store has since moved past. */
function continuesFrom(cached: CachedThread | undefined, head: string | null): string | null {
  const cachedHead = cached?.head;
  return cachedHead && head && head > cachedHead ? cachedHead : null;
}

/**
 * Disposable read cache; the append-only event store remains the authority. It holds whole
 * histories, so it keeps only the projects opened most recently (plus the Studio conversation
 * they all share) instead of every project opened since launch.
 */
export class RunSummaryReader {
  readonly #cache = new Map<string, CachedThread>();
  readonly #pending = new Map<string, Promise<EventEnvelope[]>>();
  /** The threads each cached project read, least recently opened first. */
  readonly #projects = new Map<string, string[]>();
  readonly #merged = new Map<string, { slices: EventEnvelope[][]; events: EventEnvelope[] }>();
  readonly #maxProjects: number;
  readonly store: Pick<EventStore, "getRecord" | "listThreads" | "listEvents">;
  constructor(
    store: Pick<EventStore, "getRecord" | "listThreads" | "listEvents">,
    options: { projects?: number } = {},
  ) {
    this.store = store;
    this.#maxProjects = options.projects ?? CACHED_PROJECTS;
  }

  async #readThread(id: string): Promise<EventEnvelope[]> {
    // A concurrent read may have begun before the event that invalidated this caller.
    // Wait, then recheck the durable head instead of returning its potentially older answer.
    const pending = this.#pending.get(id);
    if (pending) {
      await pending;
      return this.#readThread(id);
    }
    const promise = this.#fetchThread(id);
    this.#pending.set(id, promise);
    try {
      return await promise;
    } finally {
      this.#pending.delete(id);
    }
  }

  /** The thread up to its durable head, continuing from the cached part when the head has moved on. */
  async #fetchThread(id: string): Promise<EventEnvelope[]> {
    const head = (await this.store.getRecord(id)).latest_event_id;
    const cached = this.#cache.get(id);
    if (cached?.head === head) return cached.events;
    const after = continuesFrom(cached, head);
    const fresh = await this.store.listEvents(id, {
      ...(after ? { after } : {}),
      ...(head ? { upToInclusive: head } : {}),
    });
    const earlier = after ? (cached?.events ?? []) : [];
    const events = head === null ? [] : [...earlier, ...fresh];
    this.#cache.set(id, { head, events });
    return events;
  }

  async forProject(project: string, studioThread: string): Promise<EventEnvelope[]> {
    const threads = (await this.store.listThreads()).filter((thread) => {
      const meta = thread.metadata as { project?: string } | undefined;
      return meta?.project === project || thread.id === studioThread;
    });
    this.#opened(
      project,
      threads.map((thread) => thread.id),
      studioThread,
    );
    const slices = await Promise.all(threads.map((thread) => this.#readThread(thread.id)));
    const cached = this.#merged.get(project);
    const unchanged =
      cached &&
      cached.slices.length === slices.length &&
      slices.every((slice, index) => slice === cached.slices[index]);
    if (unchanged) return cached.events;
    const events = slices.flat().sort((a, b) => compareIds(a.created_at, b.created_at) || compareIds(a.id, b.id));
    this.#merged.set(project, { slices, events });
    return events;
  }

  /** Mark `project` most recently opened, and forget the threads of projects pushed past the bound. */
  #opened(project: string, threads: string[], studioThread: string): void {
    this.#projects.delete(project);
    this.#projects.set(project, threads);
    while (this.#projects.size > this.#maxProjects) {
      const oldest = this.#projects.entries().next().value;
      if (!oldest) break;
      const [name, forgotten] = oldest;
      this.#projects.delete(name);
      this.#merged.delete(name);
      const kept = new Set([studioThread, ...[...this.#projects.values()].flat()]);
      for (const id of forgotten) if (!kept.has(id)) this.#cache.delete(id);
    }
  }
}
