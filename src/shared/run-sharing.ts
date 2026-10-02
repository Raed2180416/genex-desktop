/**
 * Opt-in run sharing (§9.4, M5): the one typed switch that decides whether the app ever asks, the
 * consent version stamped on every shared row, and the closed `genex-evals/field/1` row an opted-in
 * user's finished build becomes. Metrics only: a field row never carries prompts, messages, code,
 * file or project names, paths, screenshots or account ids. This file holds the contract the app
 * shares with the eval scripts, the pure row builder and its closed-schema guard, and the view
 * Settings → Privacy reads; the sender that queues and posts rows is `main/run-sharing.ts`.
 * Browser-safe. Persisted and sent over the wire: never rename a value.
 */
import { DAY_MS } from "./duration.ts";
import {
  type CallCounts,
  EndedHow,
  LaunchPath,
  LaneModeServed,
  TokenRole,
  type TokenUsage,
  ToolCategory,
} from "./eval-lane.ts";
import { PermissionMode } from "./permissions.ts";
import { EngineId } from "./providers.ts";
import { ExecutionStatus } from "./run-state.ts";

/** Whether the app ever asks the user to share: never (a Settings toggle only), or once after the first finished build. */
export const RunSharingAsk = {
  Never: "never",
  AfterFirstBuild: "after-first-build",
} as const;
export type RunSharingAsk = (typeof RunSharingAsk)[keyof typeof RunSharingAsk];

/** The switch (D13): a setting only, for now. Flipping it to `AfterFirstBuild` turns on the one-time question. */
export const RUN_SHARING_ASK: RunSharingAsk = RunSharingAsk.Never;

/**
 * The consent text's version, stamped on every row as `consentVersion`, so a changed text never
 * inherits old yeses. Bump it whenever PRIVACY.md's description of sharing changes.
 */
export const RUN_SHARING_CONSENT_VERSION = "2026-10-01";

/** The schema id of a shared field row. */
export const FIELD_ROW_SCHEMA = "genex-evals/field/1";

/** What an anonymous contribution is: a field row from a real build, or a public-case eval row shared by hand. */
export const ContributionKind = {
  Field: "field",
  CommunityEval: "community-eval",
} as const;
export type ContributionKind = (typeof ContributionKind)[keyof typeof ContributionKind];

/** The random install id's shape: 32 lowercase hex characters, rotated every 90 days, never linked to an account. */
export const INSTALL_ID_PATTERN = /^[0-9a-f]{32}$/;

/** The consent version's shape: the date the consent text was last changed. */
export const CONSENT_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The operating systems a field row names; the platform only, never a release string. */
export const FieldPlatform = {
  Mac: "darwin",
  Windows: "win32",
  Linux: "linux",
} as const;
export type FieldPlatform = (typeof FieldPlatform)[keyof typeof FieldPlatform];

/** Timing a field row carries, in milliseconds after the prompt; null when not measured. */
export interface FieldTiming {
  wallMs: number | null;
  firstBootMs: number | null;
  firstPreviewMs: number | null;
  delegationP50Ms: number | null;
  /** How many build spans (chat delegations and facet builds) the run had. */
  builds: number;
}

/** In-app judge signals, as process metrics only. */
export interface FieldInAppSignals {
  victory: boolean | null;
  executionStatus: ExecutionStatus | null;
  stopCode: string | null;
  livenessMax: number | null;
  scoreboard: { passing: number; total: number; regressions: number } | null;
}

/**
 * One finished build as an opted-in user shares it. Closed: every string is a code or a version,
 * every map has a closed key set, and the guard refuses anything else.
 */
export interface FieldRow {
  schema: typeof FIELD_ROW_SCHEMA;
  kind: typeof ContributionKind.Field;
  installId: string;
  consentVersion: string;
  /** The hour the build finished (the sender drops minutes and seconds), as an ISO instant. */
  recordedAt: string;
  app: { version: string; platform: FieldPlatform };
  engine: EngineId;
  model: string;
  modeServed: LaneModeServed;
  launch: LaunchPath;
  permissionMode: PermissionMode;
  endedHow: EndedHow;
  buildOk: boolean | null;
  time: FieldTiming;
  tokens: TokenUsage;
  tokensByRole: Partial<Record<TokenRole, TokenUsage>>;
  context: { leadPeakPct: number | null; compactions: number | null };
  calls: CallCounts;
  inApp: FieldInAppSignals;
}

// ── the contribution route, as the app spells it ─────────────────────────────────────────────
// The app never imports `scripts/`, so it keeps its own copy of the few contract values the sender
// needs; `tests/conformance/eval-sharing-app-row.test.ts` holds them equal to
// `scripts/evals/remote/contract.ts`.

/** The API origin rows go to by default: the app's existing Genex API. */
export const DEFAULT_RUNS_ORIGIN = "https://api.genex.games";
/** The environment variable that points sharing at another origin, or (empty) removes it. */
export const RUNS_ORIGIN_ENV = "STUDIO_RUNS_URL";
/** POST one row here; DELETE `contributionDeletePath(installId)` to remove an install's rows. */
export const CONTRIBUTIONS_PATH = "/api/desktop/contributions";
/** The header a DELETE proves the install with: the secret kept only on this device. */
export const INSTALL_SECRET_HEADER = "x-genex-install-secret";
/** The install secret's shape: 32 lowercase hex characters, generated beside the install id. */
export const INSTALL_SECRET_PATTERN = /^[0-9a-f]{32}$/;
/** The largest row the route accepts. */
export const CONTRIBUTION_MAX_BYTES = 8 * 1024;
/** The kill switch's answer to a POST: the sender pauses and Settings says sharing is paused. DELETE stays open. */
export const CONTRIBUTIONS_PAUSED_STATUS = 410;

/** The path that deletes every row of one install. */
export function contributionDeletePath(installId: string): string {
  return `${CONTRIBUTIONS_PATH}/${encodeURIComponent(installId)}`;
}

/** How long an install id lives before a new one replaces it. */
export const INSTALL_ID_ROTATION_MS = 90 * DAY_MS;
/** How long an unsent row waits in the queue before it is dropped, never retried forever. */
export const UNSENT_ROW_TTL_MS = 7 * DAY_MS;

// ── the closed schema ─────────────────────────────────────────────────────────────────────────

/** A model id: the ledger's `MODEL_ID_PATTERN`. */
export const FIELD_MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,63}$/;
/** An app version: the ledger's `VERSION_PATTERN`. */
export const FIELD_VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?$/;
/** A UTC instant: the ledger's `INSTANT_PATTERN`. */
export const FIELD_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** A stop code: a short lowercase code, never a sentence. */
export const FIELD_STOP_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

/** The largest duration a row carries (a week), token count, call count, liveness score and check count. */
const MAX_FIELD_MS = 7 * DAY_MS;
const MAX_TOKENS = 1e11;
const MAX_CALLS = 1e7;
const MAX_LIVENESS = 1e4;
const MAX_CHECKS = 1e4;

/** A row's identity and when and where it was made: everything the builder adds to the facts. */
export interface FieldRowStamp {
  installId: string;
  consentVersion: string;
  recordedAt: string;
  app: FieldRow["app"];
}

/** What a finished build measured: a field row without its identity stamp. */
export type FieldRunFacts = Omit<FieldRow, "schema" | "kind" | "installId" | "consentVersion" | "recordedAt" | "app">;

/** The guard's answer: the row, or the dotted path of the first field it refused. */
export type FieldRowCheck = { ok: true; row: FieldRow } | { ok: false; field: string };

type Check = (value: unknown) => boolean;
interface Shape {
  readonly [key: string]: Check | Shape;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = (table: Record<string, string>): Check => {
  const values: ReadonlySet<unknown> = new Set(Object.values(table));
  return (value) => values.has(value);
};
const matches =
  (pattern: RegExp): Check =>
  (value) =>
    typeof value === "string" && pattern.test(value);
const inRange = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const upTo =
  (max: number): Check =>
  (value) =>
    inRange(value, max);
const count =
  (max: number): Check =>
  (value) =>
    inRange(value, max) && Number.isInteger(value);
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const exactly =
  (expected: unknown): Check =>
  (value) =>
    value === expected;
const isBoolean: Check = (value) => typeof value === "boolean";

/** The first field of `value` that `shape` refuses, as a dotted path; null when it fits exactly. */
function refusedField(value: unknown, shape: Shape, at: string): string | null {
  if (!isRecord(value)) return at || "row";
  const extra = Object.keys(value).find((key) => !Object.hasOwn(shape, key));
  if (extra !== undefined) return at ? `${at}.${extra}` : extra;
  for (const [key, rule] of Object.entries(shape)) {
    const path = at ? `${at}.${key}` : key;
    if (typeof rule === "function") {
      if (!rule(value[key])) return path;
      continue;
    }
    const refused = refusedField(value[key], rule, path);
    if (refused) return refused;
  }
  return null;
}

/** A record whose keys are some of a vocabulary's values, each value fitting `rule`. */
const partialRecord =
  (keys: Record<string, string>, rule: Check | Shape): Check =>
  (value) => {
    if (!isRecord(value)) return false;
    const shape: Shape = Object.fromEntries(Object.keys(value).map((key) => [key, rule]));
    return Object.keys(value).every(oneOf(keys)) && refusedField(value, shape, "") === null;
  };

const TOKENS: Shape = {
  uncachedInput: count(MAX_TOKENS),
  cacheWrite: count(MAX_TOKENS),
  cacheRead: count(MAX_TOKENS),
  output: count(MAX_TOKENS),
  reasoning: count(MAX_TOKENS),
};
const DURATION = nullable(upTo(MAX_FIELD_MS));
const SCOREBOARD: Shape = { passing: count(MAX_CHECKS), total: count(MAX_CHECKS), regressions: count(MAX_CHECKS) };

const FIELD_ROW_SHAPE: Shape = {
  schema: exactly(FIELD_ROW_SCHEMA),
  kind: exactly(ContributionKind.Field),
  installId: matches(INSTALL_ID_PATTERN),
  consentVersion: matches(CONSENT_VERSION_PATTERN),
  recordedAt: matches(FIELD_INSTANT_PATTERN),
  app: { version: matches(FIELD_VERSION_PATTERN), platform: oneOf(FieldPlatform) },
  engine: oneOf(EngineId),
  model: matches(FIELD_MODEL_PATTERN),
  modeServed: oneOf(LaneModeServed),
  launch: oneOf(LaunchPath),
  permissionMode: oneOf(PermissionMode),
  endedHow: oneOf(EndedHow),
  buildOk: nullable(isBoolean),
  time: {
    wallMs: DURATION,
    firstBootMs: DURATION,
    firstPreviewMs: DURATION,
    delegationP50Ms: DURATION,
    builds: count(MAX_CALLS),
  },
  tokens: TOKENS,
  tokensByRole: partialRecord(TokenRole, TOKENS),
  context: { leadPeakPct: nullable(upTo(100)), compactions: nullable(count(MAX_CALLS)) },
  calls: {
    modelCalls: count(MAX_CALLS),
    tools: { total: count(MAX_CALLS), byCategory: partialRecord(ToolCategory, count(MAX_CALLS)) },
  },
  inApp: {
    victory: nullable(isBoolean),
    executionStatus: nullable(oneOf(ExecutionStatus)),
    stopCode: nullable(matches(FIELD_STOP_CODE_PATTERN)),
    livenessMax: nullable(upTo(MAX_LIVENESS)),
    scoreboard: nullable((value) => refusedField(value, SCOREBOARD, "") === null),
  },
};

/**
 * The closed-schema guard: a row passes only when every field is a known code, a pattern-shaped
 * id or version, or a bounded number, no field is missing or extra, and it fits the route's size.
 * Anything free-form (a path, a prompt, a name, an email) fails one of those by construction.
 */
export function checkFieldRow(value: unknown): FieldRowCheck {
  const field = refusedField(value, FIELD_ROW_SHAPE, "");
  if (field !== null) return { ok: false, field };
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > CONTRIBUTION_MAX_BYTES) return { ok: false, field: "row" };
  return { ok: true, row: value as FieldRow };
}

/** The same usage with only its five counts. */
function tokenCounts(usage: TokenUsage): TokenUsage {
  return {
    uncachedInput: usage.uncachedInput,
    cacheWrite: usage.cacheWrite,
    cacheRead: usage.cacheRead,
    output: usage.output,
    reasoning: usage.reasoning,
  };
}

/** Each role's counts, for the roles the facts have. */
function roleCounts(byRole: FieldRunFacts["tokensByRole"]): FieldRunFacts["tokensByRole"] {
  const out: FieldRunFacts["tokensByRole"] = {};
  for (const role of Object.values(TokenRole)) {
    const usage = byRole[role];
    if (usage) out[role] = tokenCounts(usage);
  }
  return out;
}

/** The tool counts, for the categories the facts have. */
function callCounts(calls: CallCounts): CallCounts {
  const byCategory: CallCounts["tools"]["byCategory"] = {};
  for (const category of Object.values(ToolCategory)) {
    const n = calls.tools.byCategory[category];
    if (n !== undefined) byCategory[category] = n;
  }
  return { modelCalls: calls.modelCalls, tools: { total: calls.tools.total, byCategory } };
}

/** The in-app signals, field by field. */
function inAppSignals(inApp: FieldInAppSignals): FieldInAppSignals {
  const board = inApp.scoreboard;
  return {
    victory: inApp.victory,
    executionStatus: inApp.executionStatus,
    stopCode: inApp.stopCode,
    livenessMax: inApp.livenessMax,
    scoreboard: board ? { passing: board.passing, total: board.total, regressions: board.regressions } : null,
  };
}

/**
 * The row a finished build becomes: the stamp plus the facts, copied field by field so nothing
 * the facts carry beyond the closed schema reaches the row, then checked by the guard.
 */
export function buildFieldRow(facts: FieldRunFacts, stamp: FieldRowStamp): FieldRowCheck {
  const { time, context } = facts;
  return checkFieldRow({
    schema: FIELD_ROW_SCHEMA,
    kind: ContributionKind.Field,
    installId: stamp.installId,
    consentVersion: stamp.consentVersion,
    recordedAt: stamp.recordedAt,
    app: { version: stamp.app.version, platform: stamp.app.platform },
    engine: facts.engine,
    model: facts.model,
    modeServed: facts.modeServed,
    launch: facts.launch,
    permissionMode: facts.permissionMode,
    endedHow: facts.endedHow,
    buildOk: facts.buildOk,
    time: {
      wallMs: time.wallMs,
      firstBootMs: time.firstBootMs,
      firstPreviewMs: time.firstPreviewMs,
      delegationP50Ms: time.delegationP50Ms,
      builds: time.builds,
    },
    tokens: tokenCounts(facts.tokens),
    tokensByRole: roleCounts(facts.tokensByRole),
    context: { leadPeakPct: context.leadPeakPct, compactions: context.compactions },
    calls: callCounts(facts.calls),
    inApp: inAppSignals(facts.inApp),
  } satisfies FieldRow);
}

const isFieldPlatform = oneOf(FieldPlatform) as (value: unknown) => value is FieldPlatform;

/** The field platform for `process.platform`, or null for one a row never names. */
export function fieldPlatform(platform: string): FieldPlatform | null {
  return isFieldPlatform(platform) ? platform : null;
}

// ── what Settings → Privacy reads ─────────────────────────────────────────────────────────────

/** Settings → Privacy's view of sharing, as main's sender reports it. */
export interface RunSharingStatus {
  /** False when this build removed sharing (`STUDIO_RUNS_URL` set empty): Settings shows no switch. */
  available: boolean;
  /** False in developer, fixture, smoke, self-test and eval launches: the switch works, nothing is sent. */
  sends: boolean;
  /** Share build metrics: on only when the user agreed to the current consent version. */
  on: boolean;
  /** The server answered with the kill switch: nothing is sent until it lifts. */
  paused: boolean;
  /** Rows waiting to be sent. */
  queued: number;
}

/** How Delete what I shared ended. */
export const RunSharingDeleteOutcome = {
  /** The server removed every row of this install (and of its earlier ids); a new id replaces it. */
  Deleted: "deleted",
  /**
   * A defensive fallback: the server answered a DELETE with 410. Genex keeps DELETE open while
   * contributions are paused, so its kill switch never yields this, and it never pauses sending.
   * Like `Failed`, every id stays; `deleted` counts the rows earlier ids' deletes already removed.
   */
  Paused: "paused",
  /**
   * The server could not be reached or refused; the install ids and their secrets stay as they
   * were, so a retry reaches them all. `deleted` counts the rows earlier ids' deletes already removed.
   */
  Failed: "failed",
  /** A launch that never sends (developer, fixture, smoke, eval): there is nothing to delete. */
  NotSent: "not-sent",
} as const;
export type RunSharingDeleteOutcome = (typeof RunSharingDeleteOutcome)[keyof typeof RunSharingDeleteOutcome];

/** Delete what I shared: how it ended and how many rows the server removed. */
export interface RunSharingDeleteResult {
  outcome: RunSharingDeleteOutcome;
  deleted: number;
}
