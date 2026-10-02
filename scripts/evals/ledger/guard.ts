/**
 * The ledger guard (§9.3), used by the writer, the export and the report. Layer 1 is the closed
 * schema (`schema.ts`). Layer 2 is the denylist (`denylist.ts`) over every string and every map
 * key a row holds: absolute and home paths, emails, credential shapes (`src/shared/redact.ts`),
 * JWT heads, eval ingest keys, long base64 runs, anything over 120 characters, and internal
 * domains. A pattern such as a model id still admits `api.<internal domain>` or a key spelled in
 * lowercase; layer 2 is what refuses those. A refusal names the field and the rule, never the value.
 */
import { denylistRule, GuardRule } from "./denylist.ts";
import { LedgerSchemaError, validateLedgerRow } from "./schema.ts";
import type { LedgerRow } from "./types.ts";

/** A guard refusal naming the dotted field and the rule; the message never echoes the value. */
export class LedgerGuardError extends Error {
  readonly field: string;
  readonly rule: GuardRule;
  constructor(field: string, rule: GuardRule) {
    super(`ledger guard refused ${field}: ${rule}`);
    this.name = "LedgerGuardError";
    this.field = field;
    this.rule = rule;
  }
}

/** One denylist finding: where it is and which rule it breaks. */
export interface GuardFinding {
  field: string;
  rule: GuardRule;
}

/**
 * The first denylist finding anywhere in `value`: every string, and every object key (a finding
 * in a key names the object holding it, so the key itself is never repeated).
 */
export function denylistFinding(value: unknown, field = "row"): GuardFinding | null {
  if (typeof value === "string") {
    const rule = denylistRule(value);
    return rule ? { field, rule } : null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, inner] of Object.entries(value)) {
    const keyRule = denylistRule(key);
    if (keyRule) return { field, rule: keyRule };
    const found = denylistFinding(inner, field === "row" ? key : `${field}.${key}`);
    if (found) return found;
  }
  return null;
}

/** A row that passed both layers, or a `LedgerGuardError` naming the field and the rule. */
export function guardRow(value: unknown): LedgerRow {
  let row: LedgerRow;
  try {
    row = validateLedgerRow(value);
  } catch (error) {
    if (error instanceof LedgerSchemaError) throw new LedgerGuardError(error.field, GuardRule.Schema);
    throw error;
  }
  const finding = denylistFinding(row);
  if (finding) throw new LedgerGuardError(finding.field, finding.rule);
  return row;
}
