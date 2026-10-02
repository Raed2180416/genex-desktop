/** Compare plain IPC snapshots without serializing their strings or losing optional fields. */
export function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameSnapshot(a[key], b[key]));
}

/** Preserve unchanged records and the collection itself across cloned IPC responses. */
export function shareRecords<T>(previous: T[], incoming: T[], keyOf: (record: T) => string): T[] {
  const byKey = new Map(previous.map((record) => [keyOf(record), record]));
  const shared = incoming.map((record) => {
    const old = byKey.get(keyOf(record));
    return old !== undefined && sameSnapshot(old, record) ? old : record;
  });
  return shared.length === previous.length && shared.every((record, index) => record === previous[index])
    ? previous
    : shared;
}

/** Retain unchanged branches of a rebuilt plain snapshot for consumers of nested records. */
export function shareSnapshot<T>(previous: T, incoming: T): T {
  if (Object.is(previous, incoming)) return previous;
  if (Array.isArray(previous) && Array.isArray(incoming)) {
    const shared = incoming.map((value, index) => shareSnapshot(previous[index], value));
    const unchanged = sameArraySlots(previous, shared);
    return (unchanged ? previous : shared) as T;
  }
  if (!plainSnapshot(previous) || !plainSnapshot(incoming)) return incoming;
  const keys = Object.keys(incoming);
  const entries = keys.map((key) => [key, shareSnapshot(previous[key], incoming[key])] as const);
  const unchanged =
    keys.length === Object.keys(previous).length &&
    entries.every(([key, value]) => Object.hasOwn(previous, key) && Object.is(previous[key], value));
  return (unchanged ? previous : Object.fromEntries(entries)) as T;
}

function plainSnapshot(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameArraySlots(previous: unknown[], incoming: unknown[]): boolean {
  if (previous.length !== incoming.length) return false;
  for (let index = 0; index < incoming.length; index++) {
    if (Object.hasOwn(previous, index) !== Object.hasOwn(incoming, index)) return false;
    if (!Object.is(previous[index], incoming[index])) return false;
  }
  return true;
}
