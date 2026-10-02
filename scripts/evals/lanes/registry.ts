/**
 * Read and validate `evals/lanes.json`: each row must be a `LaneRegistryRow` with codes from the
 * vocabulary, an engine the app knows, and an id that is never exactly an engine id (the vocabulary
 * check refuses those literals, and a lane is data, not an engine). A malformed row names its field.
 */
import fs from "node:fs";
import path from "node:path";
import { isPluginId } from "../../../src/shared/plugin-id.ts";
import { EngineId } from "../../../src/shared/providers.ts";
import { isLedgerSafeId } from "../ledger/denylist.ts";
import {
  BrowserPin,
  ContainmentPin,
  EvalAgent,
  InstructionSet,
  LaneMode,
  LaneStatus,
  NetworkPin,
} from "../vocabulary.ts";
import { LANE_REGISTRY_SCHEMA, type LaneRegistry, type LaneRegistryRow } from "./types.ts";

/** Where the registry lives, relative to the repository root. */
export const LANE_REGISTRY_FILE = "evals/lanes.json";

/** A lane id: lowercase kebab, 3–40 characters (and one the ledger guard accepts, `isLedgerSafeId`). */
export const LANE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
/** A flags digest: sha256[:12], or `unpinned` while the lane has no argv builder yet. */
export const FLAGS_DIGEST_PATTERN = /^(?:[0-9a-f]{12}|unpinned)$/;
/** A model id as a provider spells it, or the fixture's stand-in. */
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,63}$/;
/** An effort level as either CLI spells it. */
const EFFORT_PATTERN = /^[a-z]{2,12}$/;

const ENGINE_IDS: readonly string[] = Object.values(EngineId);

/** A validation failure naming the row and field. */
export class LaneRegistryError extends Error {
  readonly rowIndex: number;
  readonly field: string;
  constructor(rowIndex: number, field: string, detail: string) {
    super(`lanes.json row ${rowIndex} (${field}): ${detail}`);
    this.name = "LaneRegistryError";
    this.rowIndex = rowIndex;
    this.field = field;
  }
}

type Check = (value: unknown) => boolean;
const codeIn =
  (table: Record<string, string>): Check =>
  (value) =>
    typeof value === "string" && Object.values(table).includes(value);
const pattern =
  (re: RegExp): Check =>
  (value) =>
    typeof value === "string" && re.test(value);

/** Distinct plugin ids, at least one: a lane that turns nothing off leaves the field out. */
const pluginIds: Check = (value) =>
  Array.isArray(value) && value.length > 0 && value.every(isPluginId) && new Set(value).size === value.length;

/** The fields a row may leave out. */
type OptionalField = "disabledPlugins";

/** Each required field of a row and what its value must be. */
const FIELDS: Record<Exclude<keyof LaneRegistryRow, OptionalField>, Check> = {
  id: (value) => pattern(LANE_ID_PATTERN)(value) && isLedgerSafeId(String(value)),
  agent: codeIn(EvalAgent),
  engine: (value) => typeof value === "string" && ENGINE_IDS.includes(value),
  model: pattern(MODEL_PATTERN),
  effort: pattern(EFFORT_PATTERN),
  mode: codeIn(LaneMode),
  network: codeIn(NetworkPin),
  browser: codeIn(BrowserPin),
  containment: codeIn(ContainmentPin),
  instructionSet: codeIn(InstructionSet),
  flagsDigest: pattern(FLAGS_DIGEST_PATTERN),
  status: codeIn(LaneStatus),
  fixture: (value) => typeof value === "boolean",
};

/** Each optional field and what its value must be when present. */
const OPTIONAL_FIELDS: Record<OptionalField, Check> = {
  disabledPlugins: pluginIds,
};

/** Refuse the first field the row should not have, or whose value is not what its check wants. */
function checkFields(row: Record<string, unknown>, rowIndex: number): void {
  for (const key of Object.keys(row))
    if (!Object.hasOwn(FIELDS, key) && !Object.hasOwn(OPTIONAL_FIELDS, key))
      throw new LaneRegistryError(rowIndex, key, "unknown field");
  const present = Object.entries(OPTIONAL_FIELDS).filter(([field]) => row[field] !== undefined);
  for (const [field, check] of [...Object.entries(FIELDS), ...present])
    if (!check(row[field])) throw new LaneRegistryError(rowIndex, field, `invalid value ${JSON.stringify(row[field])}`);
}

/** One row as a `LaneRegistryRow`, or a `LaneRegistryError` naming the first bad field. */
export function validateLaneRow(value: unknown, rowIndex = 0): LaneRegistryRow {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LaneRegistryError(rowIndex, "row", "not an object");
  const row = value as Record<string, unknown>;
  checkFields(row, rowIndex);
  if (ENGINE_IDS.includes(row.id as string))
    throw new LaneRegistryError(rowIndex, "id", "a lane id is never an engine id");
  // Plugins live in the app: a raw CLI lane has none to turn off.
  if (row.disabledPlugins !== undefined && row.agent !== EvalAgent.GenexApp)
    throw new LaneRegistryError(rowIndex, "disabledPlugins", "only a Genex lane turns plugins off");
  return row as unknown as LaneRegistryRow;
}

/** The whole registry, with unique ids. */
export function validateLaneRegistry(value: unknown): LaneRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LaneRegistryError(-1, "registry", "not an object");
  const registry = value as { schema?: unknown; lanes?: unknown };
  if (registry.schema !== LANE_REGISTRY_SCHEMA)
    throw new LaneRegistryError(-1, "schema", `expected ${LANE_REGISTRY_SCHEMA}`);
  if (!Array.isArray(registry.lanes)) throw new LaneRegistryError(-1, "lanes", "not an array");
  const lanes = registry.lanes.map((row, index) => validateLaneRow(row, index));
  const seen = new Set<string>();
  for (const [index, lane] of lanes.entries()) {
    if (seen.has(lane.id)) throw new LaneRegistryError(index, "id", `duplicate lane id ${lane.id}`);
    seen.add(lane.id);
  }
  return { schema: LANE_REGISTRY_SCHEMA, lanes };
}

/** The registry read from `evals/lanes.json` under `root`. */
export function readLaneRegistry(root: string): LaneRegistry {
  return validateLaneRegistry(JSON.parse(fs.readFileSync(path.join(root, LANE_REGISTRY_FILE), "utf8")));
}

/** The registry row for a lane id, or undefined. */
export function laneById(registry: LaneRegistry, id: string): LaneRegistryRow | undefined {
  return registry.lanes.find((lane) => lane.id === id);
}
