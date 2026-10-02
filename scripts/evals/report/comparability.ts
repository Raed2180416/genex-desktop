/**
 * Comparability (§9.1, §10.1): which pinned facts two runs must share before their numbers may be
 * compared. Every row reduces to a per-lane comparability key of run pins and grading pins, each a
 * normalised `PinFact`. An axis names the facts it is allowed to move; any other difference
 * refuses, `na` (a Genex-only pin on a raw lane) compares equal, and `unavailable` refuses always,
 * even on the axis, because an unknown value cannot be shown to match. Grading pins never move on
 * any axis: a grader or prober bump is a `regrade`, not a comparison.
 */
import { isMeasured, type Pinned, type RunRow } from "../ledger/types.ts";
import { Axis, UnavailableReason } from "../vocabulary.ts";

/** A pin as the comparator sees it: a normalised string, not applicable, or unavailable with its reason. */
export const PinFactKind = {
  Measured: "measured",
  NotApplicable: "na",
  Unavailable: "unavailable",
} as const;
export type PinFactKind = (typeof PinFactKind)[keyof typeof PinFactKind];

/** One normalised pin. */
export type PinFact =
  | { kind: typeof PinFactKind.Measured; value: string }
  | { kind: typeof PinFactKind.NotApplicable }
  | { kind: typeof PinFactKind.Unavailable; reason: UnavailableReason };

/** The fields of the comparability key, spelled as the refusal prints them. */
export const PinField = {
  CaseVersion: "case.version",
  LaneId: "lane.id",
  LaneAgent: "lane.agent",
  LaneEngine: "lane.engine",
  LaneMode: "lane.mode",
  HarnessPin: "lane.harnessPin",
  BrowserPin: "lane.browser",
  ModelMain: "model.main",
  Effort: "model.effort",
  CliVersion: "run.cliVersion",
  LaneWrapperDigest: "run.laneWrapperDigest",
  ContainmentDigest: "run.containmentDigest",
  InstructionSha: "run.instructionSha",
  AppSha: "run.appSha",
  BuildId: "run.buildId",
  HarnessSeedDigest: "run.harnessSeedDigest",
  ProberVersion: "grading.proberVersion",
  SoakMs: "grading.soakMs",
  GraderPromptSha: "grading.graderPromptSha",
  GraderModels: "grading.graderModels",
  PairwiseRubricSha: "grading.pairwiseRubricSha",
  ShimMode: "grading.shimMode",
  RendererMode: "grading.rendererMode",
  EndpointsSha: "grading.endpointsSha",
} as const;
export type PinField = (typeof PinField)[keyof typeof PinField];

/** A row's comparability key: every field, normalised. */
export type ComparabilityKey = Record<PinField, PinFact>;

/** The lane's own identity: what the product and model axes change on purpose. */
const LANE_IDENTITY: readonly PinField[] = [
  PinField.LaneId,
  PinField.LaneAgent,
  PinField.LaneMode,
  PinField.HarnessPin,
  PinField.BrowserPin,
  PinField.LaneWrapperDigest,
  PinField.ContainmentDigest,
  PinField.InstructionSha,
];

/** The app build under test: what the version axis changes on purpose. */
const APP_BUILD: readonly PinField[] = [
  PinField.AppSha,
  PinField.BuildId,
  PinField.HarnessSeedDigest,
  PinField.InstructionSha,
  PinField.HarnessPin,
];

/** The fields each axis is allowed to move; everything else must match. */
export const AXIS_FIELDS: Record<Axis, readonly PinField[]> = {
  [Axis.ProductDefault]: LANE_IDENTITY,
  [Axis.ProductHarness]: LANE_IDENTITY,
  [Axis.ModelStack]: [...LANE_IDENTITY, PinField.LaneEngine, PinField.ModelMain, PinField.CliVersion],
  [Axis.Version]: APP_BUILD,
  [Axis.Cli]: [PinField.CliVersion, PinField.LaneWrapperDigest],
};

type PinInput = Pinned<string | number | boolean | readonly string[]> | null;

function hasFlag(value: object, flag: string): boolean {
  return flag in value;
}

/** Normalise one pin: numbers and booleans as strings, lists sorted and joined by `+`, null as not recorded. */
export function pinFact(value: PinInput): PinFact {
  if (value === null) return { kind: PinFactKind.Unavailable, reason: UnavailableReason.NotRecorded };
  if (Array.isArray(value)) return { kind: PinFactKind.Measured, value: [...value].sort().join("+") };
  if (!isMeasured(value) && typeof value === "object") {
    if (hasFlag(value, "na")) return { kind: PinFactKind.NotApplicable };
    const reason = "reason" in value ? value.reason : UnavailableReason.NotRecorded;
    return { kind: PinFactKind.Unavailable, reason };
  }
  return { kind: PinFactKind.Measured, value: String(value).trim() };
}

/** The comparability key of one row (§9.1 run pins plus grading pins). */
export function comparabilityKey(row: RunRow): ComparabilityKey {
  const { run, grading } = row.pins;
  return {
    [PinField.CaseVersion]: pinFact(row.case.version),
    [PinField.LaneId]: pinFact(row.lane.id),
    [PinField.LaneAgent]: pinFact(row.lane.agent),
    [PinField.LaneEngine]: pinFact(row.lane.engine),
    [PinField.LaneMode]: pinFact(row.lane.mode),
    [PinField.HarnessPin]: pinFact(row.lane.harnessPin),
    [PinField.BrowserPin]: pinFact(row.lane.browser),
    [PinField.ModelMain]: pinFact(row.model.main),
    [PinField.Effort]: pinFact(row.model.effort),
    [PinField.CliVersion]: pinFact(run.cliVersion),
    [PinField.LaneWrapperDigest]: pinFact(run.laneWrapperDigest),
    [PinField.ContainmentDigest]: pinFact(run.containmentDigest),
    [PinField.InstructionSha]: pinFact(run.instructionSha),
    [PinField.AppSha]: pinFact(run.appSha),
    [PinField.BuildId]: pinFact(run.buildId),
    [PinField.HarnessSeedDigest]: pinFact(run.harnessSeedDigest),
    [PinField.ProberVersion]: pinFact(grading.proberVersion),
    [PinField.SoakMs]: pinFact(grading.soakMs),
    [PinField.GraderPromptSha]: pinFact(grading.graderPromptSha),
    [PinField.GraderModels]: pinFact(grading.graderModels),
    [PinField.PairwiseRubricSha]: pinFact(grading.pairwiseRubricSha),
    [PinField.ShimMode]: pinFact(grading.shimMode),
    [PinField.RendererMode]: pinFact(grading.rendererMode),
    [PinField.EndpointsSha]: pinFact(grading.endpointsSha),
  };
}

/** Why a field refuses: its values differ off the axis, or one side is unavailable. */
export const DifferenceWhy = {
  Differs: "differs",
  Unavailable: "unavailable",
} as const;
export type DifferenceWhy = (typeof DifferenceWhy)[keyof typeof DifferenceWhy];

/** One refusing field. */
export interface PinDifference {
  field: PinField;
  a: PinFact;
  b: PinFact;
  why: DifferenceWhy;
}

/** A refusal: every refusing field, and the sentence the report prints. */
export interface ComparabilityRefusal {
  axis: Axis | null;
  differences: PinDifference[];
  text: string;
}

/** How a pin fact prints in a refusal. */
export function showPinFact(fact: PinFact): string {
  if (fact.kind === PinFactKind.Measured) return fact.value;
  if (fact.kind === PinFactKind.NotApplicable) return "n/a";
  return `unavailable (${fact.reason})`;
}

function difference(field: PinField, a: PinFact, b: PinFact, onAxis: boolean): PinDifference | null {
  if (a.kind === PinFactKind.Unavailable || b.kind === PinFactKind.Unavailable) {
    return { field, a, b, why: DifferenceWhy.Unavailable };
  }
  if (onAxis || a.kind === PinFactKind.NotApplicable || b.kind === PinFactKind.NotApplicable) return null;
  return a.value === b.value ? null : { field, a, b, why: DifferenceWhy.Differs };
}

function refusalText(differences: readonly PinDifference[], axis: Axis | null): string {
  const count = differences.length;
  const scope = axis === null ? "no axis was declared for" : `are not the declared axis (${axis})`;
  const detail = differences.map((d) => `${d.field}: ${showPinFact(d.a)} vs ${showPinFact(d.b)}`).join(" · ");
  return `refusing to compare — these runs differ on ${count} pinned field${count === 1 ? "" : "s"} that ${scope}: ${detail}`;
}

/** Null when the two keys may be compared on `axis` (null: no axis, everything must match), else the refusal. */
export function comparabilityRefusal(
  a: ComparabilityKey,
  b: ComparabilityKey,
  axis: Axis | null,
): ComparabilityRefusal | null {
  const allowed = new Set<PinField>(axis === null ? [] : AXIS_FIELDS[axis]);
  const differences = Object.values(PinField)
    .map((field) => difference(field, a[field], b[field], allowed.has(field)))
    .filter((found): found is PinDifference => found !== null);
  if (differences.length === 0) return null;
  return { axis, differences, text: refusalText(differences, axis) };
}

function byCase(rows: readonly RunRow[]): Map<string, RunRow[]> {
  const cases = new Map<string, RunRow[]>();
  for (const row of rows) cases.set(row.case.id, [...(cases.get(row.case.id) ?? []), row]);
  return cases;
}

/** Null when every row shares every pin (no axis), else the first refusal against the first row. */
export function sharedPinsRefusal(rows: readonly RunRow[]): ComparabilityRefusal | null {
  const [first, ...rest] = rows.map(comparabilityKey);
  for (const key of rest) {
    const refusal = comparabilityRefusal(first, key, null);
    if (refusal) return refusal;
  }
  return null;
}

/**
 * Null when two arms may be compared on `axis`, else the first refusal. Checked case by case: rows
 * of one case in one arm must share every pin, and the arms may differ only on the axis.
 */
export function armsRefusal(armA: readonly RunRow[], armB: readonly RunRow[], axis: Axis): ComparabilityRefusal | null {
  const casesA = byCase(armA);
  const casesB = byCase(armB);
  for (const [caseId, rowsA] of casesA) {
    const rowsB = casesB.get(caseId);
    if (!rowsB) continue;
    const refusal =
      sharedPinsRefusal(rowsA) ??
      sharedPinsRefusal(rowsB) ??
      comparabilityRefusal(comparabilityKey(rowsA[0]), comparabilityKey(rowsB[0]), axis);
    if (refusal) return refusal;
  }
  return null;
}
