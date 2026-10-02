/**
 * UUIDv7 — time-ordered identifiers.
 *
 * Port of Exo's `crates/exoharness/src/uuid7.rs` semantics: event ids are
 * UUIDv7 so that `events/<uuid7>.json` filenames sort lexicographically by creation time.
 * Everything downstream (pagination cursors, `listEvents({after})`, log tailing, fork
 * `up_to_inclusive` filtering) relies on that property, so the generator is **monotonic**:
 * ids minted inside the same millisecond still sort in mint order.
 *
 * Layout (RFC 9562):
 *   48 bit  unix_ts_ms
 *    4 bit  version (7)
 *   12 bit  rand_a      — used here as a monotonic intra-millisecond counter
 *    2 bit  variant (0b10)
 *   62 bit  rand_b      — random, re-seeded whenever the counter advances
 */
import { randomBytes } from "node:crypto";

const MAX_COUNTER = 0x0fff;

/**
 * Mint a UUIDv7 at `nowMs` that sorts after every id this generator minted before and, when
 * given, after `after` too. A generator's floor lives in memory, so it starts empty on every
 * launch; `after` carries the floor over from a stored log (see `EventStore.appendEvents`).
 */
export type Uuidv7Generator = (nowMs?: number, after?: string | null) => string;

/** The newest millisecond and counter a generator has minted (or been told of): every id sorts after it. */
interface MintFloor {
  lastMs: number;
  counter: number;
}

/** Resume past a stored id: same millisecond, its counter, so the next mint is later still. */
function raiseFloor(floor: MintFloor, after: string): void {
  const afterMs = uuid7Millis(after);
  const afterCounter = uuid7Counter(after);
  const later = afterMs > floor.lastMs || (afterMs === floor.lastMs && afterCounter > floor.counter);
  if (!later) return;
  floor.lastMs = afterMs;
  floor.counter = afterCounter;
}

/** One more id in the floor's millisecond; the millisecond it lands in. */
function nextInLastMillisecond(floor: MintFloor): number {
  floor.counter += 1;
  if (floor.counter <= MAX_COUNTER) return floor.lastMs;
  // Counter exhausted inside this millisecond: borrow from the future rather than
  // emit a non-monotonic id. (Exo's generator makes the same trade.)
  floor.lastMs += 1;
  floor.counter = 0;
  return floor.lastMs;
}

/** The millisecond a mint at `nowMs` takes, with the floor moved past it. */
function mintMillis(floor: MintFloor, nowMs: number): number {
  // The same millisecond, or a clock that went backwards (NTP step, sleep/wake): never regress
  // the id space.
  if (nowMs <= floor.lastMs) return nextInLastMillisecond(floor);
  floor.lastMs = nowMs;
  floor.counter = 0;
  return nowMs;
}

/** A generator with its own floor: the process shares one (`uuidv7`); tests make fresh ones. */
export function createUuidv7Generator(): Uuidv7Generator {
  const floor: MintFloor = { lastMs: -1, counter: 0 };
  return (nowMs = Date.now(), after = null) => {
    if (after && isUuidV7(after)) raiseFloor(floor, after);
    const ms = mintMillis(floor, nowMs);
    return encode(ms, floor.counter);
  };
}

/** The process's generator: every id minted in this process sorts after the ones before it. */
export const processUuidv7: Uuidv7Generator = createUuidv7Generator();

/** Generate a monotonic UUIDv7 string (lowercase, hyphenated). */
export function uuidv7(nowMs: number = Date.now()): string {
  return processUuidv7(nowMs);
}

function encode(ms: number, counter: number): string {
  const bytes = randomBytes(16);
  // 48-bit timestamp, big-endian.
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  // version 7 + high nibble of the counter
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  // variant 0b10
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isUuidV7(value: string): boolean {
  return UUID_RE.test(value) && value.charAt(14) === "7" && "89ab".includes(value.charAt(19));
}

/** Milliseconds encoded in a UUIDv7. */
export function uuid7Millis(id: string): number {
  const hex = id.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}

/** The 12-bit `rand_a` field, which this generator uses as the intra-millisecond counter. */
function uuid7Counter(id: string): number {
  return Number.parseInt(id.slice(15, 18), 16);
}

/** ISO-8601 timestamp encoded in a UUIDv7 — the `created_at` of an event. */
export function uuid7Timestamp(id: string): string {
  return new Date(uuid7Millis(id)).toISOString();
}

/**
 * Order comparison for UUIDv7 strings. Plain lexicographic comparison is correct because the
 * encoding is fixed-width lowercase hex with the timestamp in the most significant position.
 */
export function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Short human-facing id (used for run ids, snapshot ids, update ids). */
export function shortId(prefix: string): string {
  return `${prefix}_${uuidv7().replace(/-/g, "").slice(0, 20)}`;
}
