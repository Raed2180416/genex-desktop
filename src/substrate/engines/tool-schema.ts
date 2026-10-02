/**
 * Carrying a real JSON Schema across the three coding paths.
 *
 * Studio's own live tools have always been flat — string and number properties, nothing nested —
 * because that is all the two delegated engines' tool surfaces were taught to read. An MCP
 * connector's tools are not: they have arrays, enums, integers, nested objects and `$defs`.
 *
 * So `liveTools` gained an optional `inputSchema`, authoritative when present, and this module
 * is the one place that knows how to turn it into each engine's shape:
 *  - `zodShapeFromJsonSchema` for the Claude Agent SDK's in-process `studio` server;
 *  - `flatParameters` for everything that still only understands the flat projection (the Codex
 *    bridge's instructions, the local harness's tool list, the Connectors card);
 *  - `exposedToolName` so a server's `weird.name/x` becomes something an engine will accept.
 *
 * The fallback matters more than the happy path: when zod cannot build a schema, the tool stays
 * callable with `unknown` arguments and the schema itself is appended to the description, so the
 * model still knows what to send. A tool that will not compile is worse than a tool without
 * type hints.
 */
import type { ZodTypeAny, z as Zod } from "zod";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** JSON Schema types the flat projection can name; anything else reads as a string. */
const FLAT_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);
/** An enum's description lists at most this many choices. */
const ENUM_CHOICES_LISTED = 24;
/** A schema longer than this stays out of the description: it is prompt text on every turn. */
const DESCRIBED_SCHEMA_CHARS = 4000;
/** An exposed tool name keeps at most this many characters. */
const EXPOSED_NAME_CHARS = 48;

/**
 * Build the zod raw shape the Agent SDK's `tool()` wants from a JSON Schema.
 *
 * `z.fromJSONSchema` handles required/optional, `$defs` and local `$ref` on its own. When it
 * throws — a remote `$ref`, an unsupported format, a dialect zod does not know — every declared
 * property falls back to `z.unknown()`, optional unless required, keeping its description. The
 * caller pairs that fallback with `describeWithSchema` so the schema survives as prose.
 */
export function zodShapeFromJsonSchema(schema: unknown, z: typeof Zod): Record<string, ZodTypeAny> {
  const source = isRecord(schema) ? schema : {};
  const properties = isRecord(source.properties) ? source.properties : {};
  const required = new Set(
    Array.isArray(source.required) ? source.required.filter((k): k is string => typeof k === "string") : [],
  );
  try {
    const built = z.fromJSONSchema(source as Parameters<typeof z.fromJSONSchema>[0]) as unknown;
    const shape = (built as { shape?: unknown })?.shape;
    if (isRecord(shape) && Object.keys(shape).length) return shape as Record<string, ZodTypeAny>;
    if (isRecord(shape) && !Object.keys(properties).length) return {};
  } catch {
    // Fall through to the per-property fallback below.
  }
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, property] of Object.entries(properties)) {
    const description = isRecord(property) && typeof property.description === "string" ? property.description : "";
    const field = z.unknown().describe(description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

/**
 * Append the schema to a tool description, for the path where zod could not express it.
 * Capped: a description is prompt text on every turn, not a schema registry.
 */
export function describeWithSchema(description: string, schema: unknown): string {
  if (!isRecord(schema)) return description;
  let text: string;
  try {
    text = JSON.stringify(schema);
  } catch {
    return description;
  }
  if (!text || text.length > DESCRIBED_SCHEMA_CHARS) return description;
  return `${description}\n\nArguments: JSON matching ${text}`;
}

/** One property of the flat projection: a type word, and a description that names any enum. */
type FlatProperty = { type: string; description?: string };

/** One schema property flattened: an unknown type reads as a string; an enum's choices join the description. */
function flatProperty(shape: Json): FlatProperty {
  const raw = schemaType(shape);
  const type = raw !== undefined && FLAT_TYPES.has(raw) ? raw : "string";
  const enumeration = Array.isArray(shape.enum)
    ? shape.enum.filter((v) => typeof v === "string" || typeof v === "number").slice(0, ENUM_CHOICES_LISTED)
    : [];
  const parts = [
    typeof shape.description === "string" ? shape.description : "",
    enumeration.length ? `One of: ${enumeration.join(", ")}.` : "",
  ].filter(Boolean);
  return parts.length ? { type, description: parts.join(" ") } : { type };
}

/** The schema's own type word; of a list of types, the first that is not "null". */
export function schemaType(shape: Json): string | undefined {
  if (typeof shape.type === "string") return shape.type;
  if (!Array.isArray(shape.type)) return undefined;
  const found = shape.type.find((t) => typeof t === "string" && t !== "null");
  return typeof found === "string" ? found : undefined;
}

/** The flat projection older consumers read: top-level properties, one line of type each. */
export function flatParameters(schema: unknown): {
  type: "object";
  properties: Record<string, FlatProperty>;
  required?: string[];
} {
  const source = isRecord(schema) ? schema : {};
  const properties: Record<string, FlatProperty> = {};
  const declared = isRecord(source.properties) ? source.properties : {};
  for (const [key, property] of Object.entries(declared)) {
    properties[key] = flatProperty(isRecord(property) ? property : {});
  }
  const required = Array.isArray(source.required)
    ? source.required.filter((k): k is string => typeof k === "string" && k in properties)
    : [];
  return required.length ? { type: "object", properties, required } : { type: "object", properties };
}

/**
 * A tool name an engine will accept. MCP allows names Claude's `mcp__server__tool` addressing
 * and the Codex bridge's argv do not, so `weird.name/x` becomes `weird_name_x`. The registry
 * keeps the raw name and de-duplicates collisions with `_2`, `_3`.
 */
export function exposedToolName(raw: string): string {
  const sanitized = String(raw ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, EXPOSED_NAME_CHARS)
    .replace(/_+$/, "");
  return sanitized || "tool";
}
