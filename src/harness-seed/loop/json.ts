/**
 * The shape of an untyped value the host, the page or a model hands back: whether its fields can
 * be read at all, and whether it is a JSON object rather than a list.
 */
import type { AnyRecord } from "../types/harness.d.ts";

/** An object (a list counts too): something whose fields can be read. */
export function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object";
}

/** An object that is not a list: a JSON object. */
export function isPlainRecord(value: unknown): value is AnyRecord {
  return isRecord(value) && !Array.isArray(value);
}
