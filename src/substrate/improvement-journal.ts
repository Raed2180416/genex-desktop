/**
 * Improvement journal — durable architect jobs.
 *
 * The UpdateJournal's durability trick applied to self-improvement: the intent is on disk
 * before any work starts, each stage checkpoints, and a laptop closed mid-job is a non-event —
 * the next idle window picks the record back up. No wall clock anywhere: "nightly" is dead;
 * jobs run whenever the app is open and idle.
 */
import path from "node:path";
import { atomicWriteJson, ensureDir, listJsonFiles, readJson } from "./fsx.ts";
import { shortId } from "./ids.ts";

/** Where an architect job stands. Persisted in each record: never rename a value. */
export const ImprovementStatus = {
  Queued: "queued",
  Validating: "validating",
  Applied: "applied",
  Rejected: "rejected",
  Failed: "failed",
} as const;
export type ImprovementStatus = (typeof ImprovementStatus)[keyof typeof ImprovementStatus];

const MESSAGE = {
  Requeued: "requeued after restart",
} as const;

/** A job in this status is still open: it has no `finished_at` yet. */
function isOpen(status: ImprovementStatus): boolean {
  return status === ImprovementStatus.Queued || status === ImprovementStatus.Validating;
}

export interface ImprovementRecord {
  id: string;
  kind: "architect";
  status: ImprovementStatus;
  reason: string;
  requested_at: string;
  /** The one structural change the architect proposed. */
  proposal?: { file: string; reason: string };
  snapshot_id?: string;
  post_snapshot_id?: string;
  finished_at?: string;
  note?: string;
}

export class ImprovementJournal {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  async queue(reason: string): Promise<ImprovementRecord> {
    const record: ImprovementRecord = {
      id: shortId("imp"),
      kind: "architect",
      status: ImprovementStatus.Queued,
      reason,
      requested_at: new Date().toISOString(),
    };
    await ensureDir(this.dir);
    await atomicWriteJson(path.join(this.dir, `${record.id}.json`), record);
    return record;
  }

  async update(id: string, patch: Partial<ImprovementRecord>): Promise<ImprovementRecord | null> {
    const file = path.join(this.dir, `${id}.json`);
    const record = await readJson<ImprovementRecord>(file).catch(() => null);
    if (!record) return null;
    Object.assign(record, patch);
    if (patch.status && !isOpen(patch.status)) {
      record.finished_at = new Date().toISOString();
    }
    await atomicWriteJson(file, record);
    return record;
  }

  async all(): Promise<ImprovementRecord[]> {
    const out: ImprovementRecord[] = [];
    for (const file of await listJsonFiles(this.dir).catch(() => [] as string[])) {
      const record = await readJson<ImprovementRecord>(path.join(this.dir, file)).catch(() => null);
      if (record?.kind === "architect") out.push(record);
    }
    return out.sort((a, b) => (a.requested_at < b.requested_at ? -1 : 1));
  }

  async pending(): Promise<ImprovementRecord[]> {
    return (await this.all()).filter((r) => r.status === ImprovementStatus.Queued);
  }

  /** Boot sweep: a job the app died inside goes back in the queue — mid-job death is a non-event. */
  async sweep(): Promise<void> {
    for (const record of await this.all()) {
      if (record.status === ImprovementStatus.Validating)
        await this.update(record.id, { status: ImprovementStatus.Queued, note: MESSAGE.Requeued });
    }
  }

  /** The newest finished job of any outcome — the scheduler's pacing anchor. */
  async newestFinishedAt(): Promise<string | null> {
    const finished = (await this.all()).flatMap((r) => (r.finished_at ? [r.finished_at] : []));
    return finished.sort().at(-1) ?? null;
  }
}
