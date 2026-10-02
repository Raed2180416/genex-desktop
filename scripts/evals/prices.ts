/**
 * The price table (`evals/prices.json`) behind `cost.apiEquivalentUsd` (Rule 15): dated
 * API-equivalent USD per million tokens, per model. A model without a published price is marked
 * unknown and its cost becomes `unavailable: price-unknown`, never a guess. Reasoning tokens are
 * priced as output, which is how every provider bills them.
 */
import fs from "node:fs";
import path from "node:path";
import type { TokenUsage } from "../../src/shared/eval-lane.ts";
import { DATE_PATTERN, MODEL_ID_PATTERN } from "./ledger/types.ts";

/** The table's schema id. */
export const PRICE_TABLE_SCHEMA = "genex-evals/prices/1";
/** Where the table lives, relative to the repository root. */
export const PRICE_TABLE_FILE = "evals/prices.json";
/** The unit every number is in. */
export const PRICE_UNIT = "usd-per-million-tokens";

/** A published price: USD per million tokens of each kind. */
export interface ModelPrice {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** A model the table lists without a price. */
export interface UnknownPrice {
  unknown: true;
}

/** The table. */
export interface PriceTable {
  schema: typeof PRICE_TABLE_SCHEMA;
  asOf: string;
  unit: typeof PRICE_UNIT;
  models: Record<string, ModelPrice | UnknownPrice>;
}

const PRICE_KEYS = ["input", "cacheWrite", "cacheRead", "output"] as const;
const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A price table's validation failure, naming the field. */
export class PriceTableError extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(`prices.json (${field}): ${detail}`);
    this.name = "PriceTableError";
    this.field = field;
  }
}

function validateModelPrice(model: string, value: unknown): ModelPrice | UnknownPrice {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PriceTableError(model, "not an object");
  const row = value as Record<string, unknown>;
  if (row.unknown === true) {
    if (Object.keys(row).length !== 1) throw new PriceTableError(model, "an unknown price carries no numbers");
    return { unknown: true };
  }
  for (const key of Object.keys(row))
    if (!(PRICE_KEYS as readonly string[]).includes(key)) throw new PriceTableError(`${model}.${key}`, "unknown field");
  for (const key of PRICE_KEYS)
    if (!isPrice(row[key])) throw new PriceTableError(`${model}.${key}`, "a non-negative number is required");
  return { input: row.input, cacheWrite: row.cacheWrite, cacheRead: row.cacheRead, output: row.output } as ModelPrice;
}

/** The value as a `PriceTable`, or a `PriceTableError`. */
export function validatePriceTable(value: unknown): PriceTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PriceTableError("table", "not an object");
  const table = value as Record<string, unknown>;
  if (table.schema !== PRICE_TABLE_SCHEMA) throw new PriceTableError("schema", `expected ${PRICE_TABLE_SCHEMA}`);
  if (typeof table.asOf !== "string" || !DATE_PATTERN.test(table.asOf))
    throw new PriceTableError("asOf", "a yyyy-mm-dd date is required");
  if (table.unit !== PRICE_UNIT) throw new PriceTableError("unit", `expected ${PRICE_UNIT}`);
  if (!table.models || typeof table.models !== "object" || Array.isArray(table.models))
    throw new PriceTableError("models", "not an object");
  const models: PriceTable["models"] = {};
  for (const [model, price] of Object.entries(table.models)) {
    if (!MODEL_ID_PATTERN.test(model)) throw new PriceTableError(model, "not a model id");
    models[model] = validateModelPrice(model, price);
  }
  return { schema: PRICE_TABLE_SCHEMA, asOf: table.asOf, unit: PRICE_UNIT, models };
}

/** The table read from `evals/prices.json` under `root`. */
export function readPriceTable(root: string): PriceTable {
  return validatePriceTable(JSON.parse(fs.readFileSync(path.join(root, PRICE_TABLE_FILE), "utf8")));
}

/** The API-equivalent cost of a usage at a model's price, or null when the table has no price for it. */
export function apiEquivalentUsd(table: PriceTable, model: string, usage: TokenUsage): number | null {
  const price = table.models[model];
  if (!price || "unknown" in price) return null;
  const perToken = (usd: number, tokens: number) => (usd * tokens) / 1_000_000;
  return (
    perToken(price.input, usage.uncachedInput) +
    perToken(price.cacheWrite, usage.cacheWrite) +
    perToken(price.cacheRead, usage.cacheRead) +
    perToken(price.output, usage.output)
  );
}
