import { COVER_STILLS_DB } from "../storage.ts";

/**
 * The first frame each cover sphere drew on this machine, kept in IndexedDB so a row at rest shows
 * a finished image and startup compiles no shader. It is a cache: when IndexedDB is unavailable
 * or a still is missing, the sphere simply draws it again.
 */
const STORE = "stills";
/** Stills kept; past this the oldest go first. A still is a few kilobytes. */
const MAX_STILLS = 400;
/** WebP quality for a still: small, and indistinguishable from the live frame at sidebar size. */
const STILL_QUALITY = 0.85;
type StillRecord = { key: string; blob: Blob; at: number };

let database: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(COVER_STILLS_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

/** Every saved still by key; empty when nothing is saved or IndexedDB is unavailable. */
export async function loadCoverStills(): Promise<Map<string, Blob>> {
  const db = await open();
  if (!db) return new Map();
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(new Map((request.result as StillRecord[]).map(({ key, blob }) => [key, blob])));
      request.onerror = () => resolve(new Map());
    } catch {
      resolve(new Map());
    }
  });
}

/** Keep `canvas` as the still for `key`; a failure only means it is drawn again next time. */
export async function saveCoverStill(key: string, canvas: HTMLCanvasElement): Promise<Blob | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", STILL_QUALITY));
  const db = await open();
  if (!blob || !db) return blob;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    store.put({ key, blob, at: Date.now() } satisfies StillRecord);
    const all = store.getAll();
    all.onsuccess = () => {
      const records = all.result as StillRecord[];
      const extra = records.length - MAX_STILLS;
      if (extra > 0) for (const old of records.sort((a, b) => a.at - b.at).slice(0, extra)) store.delete(old.key);
    };
  } catch {
    // A full or locked store keeps what it has.
  }
  return blob;
}
