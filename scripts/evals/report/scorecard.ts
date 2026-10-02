/**
 * The campaign scorecard (`report <campaign> --md`, §11): one table per case, one row per lane in
 * the registry's order (A–D), and the plan's columns: n with void, harness and replaced counts;
 * boot and playable rates with Wilson intervals; Kaplan–Meier medians of first playable and time to
 * done with their censored counts; median wall time, tokens by kind, lead context peak and tool
 * calls by category; `scoreAllRuns` per grader family and combined (a judge-skipped or no-build run
 * scores 0 in both); the pairwise win rate against the sibling lane per family (never summed across
 * families), read from each run pair's latest judging pass only; and the API-equivalent estimate. The
 * header shows the case's exposure, nulls print as words, and the footer says how many distinct
 * cases the campaign has against the five a direction needs.
 */
import { MINUTE_MS } from "../../../src/shared/duration.ts";
import type { TokenUsage } from "../../../src/shared/eval-lane.ts";
import type { PairwiseRow, RunRow } from "../ledger/types.ts";
import {
  Axis,
  CaseExposure,
  Coverage,
  GraderFamily,
  PairFacet,
  PairOrder,
  PairOutcome,
  PairPick,
  RowKind,
  ToolCategory,
} from "../vocabulary.ts";
import { DIRECTION_FLOOR, DOT, formatMinutes, formatPercent } from "./compare.ts";
import { countsInN, formatMetricValue, METRICS, MetricId, survivalObservation } from "./endpoints.ts";
import { type Interval, kaplanMeier, mean, median, wilson } from "./stats.ts";

/** A rate: passes of the runs that measured it, and its Wilson interval (null with no runs). */
export interface RateCell {
  passes: number;
  n: number;
  interval: Interval | null;
}

/** A Kaplan–Meier summary: never a median without the censored count beside it. */
export interface SurvivalCell {
  n: number;
  censored: number;
  medianMs: number | null;
}

/** One family's pairwise tally for a lane against its sibling. */
export interface PairTally {
  /** Judged pairs only: a forfeit is counted apart, so the judged rate stays auditable. */
  wins: number;
  losses: number;
  ties: number;
  inconsistent: number;
  invalid: number;
  /** Pairs won because the sibling shipped a typed no-build. */
  forfeitWins: number;
  /** Pairs lost because this lane shipped a typed no-build. */
  forfeitLosses: number;
}

/** The token kinds a row prints, in `TokenUsage` order. */
export const TOKEN_KINDS: readonly (keyof TokenUsage)[] = [
  "uncachedInput",
  "cacheWrite",
  "cacheRead",
  "output",
  "reasoning",
];

const TOKEN_METRIC: Record<keyof TokenUsage, MetricId> = {
  uncachedInput: MetricId.UncachedInput,
  cacheWrite: MetricId.CacheWrite,
  cacheRead: MetricId.CacheRead,
  output: MetricId.Output,
  reasoning: MetricId.Reasoning,
};

/** One lane's row in a case's table. */
export interface LaneRow {
  letter: string;
  laneId: string;
  n: number;
  voided: number;
  harness: number;
  replaced: number;
  boot: RateCell;
  playable: RateCell;
  firstPlayable: SurvivalCell;
  toDone: SurvivalCell;
  wallMs: number | null;
  tokens: Record<keyof TokenUsage, number | null>;
  leadPeakPct: number | null;
  /** Median calls per category over runs with full call coverage; null when none had it. */
  tools: [ToolCategory, number][] | null;
  checklist: { combined: number | null; byFamily: [GraderFamily, number | null][] };
  pairwise: { sibling: string; byFamily: [GraderFamily, PairTally][] } | null;
  apiEquivalentUsd: number | null;
}

/** One case's table. */
export interface CaseCard {
  caseId: string;
  caseVersion: string;
  exposure: CaseExposure;
  lanes: LaneRow[];
}

/** A campaign's scorecard. */
export interface Scorecard {
  campaignId: string;
  cases: CaseCard[];
  distinctCases: number;
}

/** What a scorecard is built from: a campaign's current rows, its pairwise rows and the registry's lane order. */
export interface ScorecardInput {
  campaignId: string;
  rows: readonly RunRow[];
  pairwise?: readonly PairwiseRow[];
  laneOrder: readonly string[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function values(rows: readonly RunRow[], metric: MetricId): number[] {
  const read = METRICS[metric].read;
  return read ? rows.map(read).filter((value): value is number => value !== null) : [];
}

function rateCell(rows: readonly RunRow[], metric: MetricId): RateCell {
  const measured = values(rows, metric);
  const passes = measured.filter((value) => value === 1).length;
  return { passes, n: measured.length, interval: measured.length > 0 ? wilson(passes, measured.length) : null };
}

function survivalCell(rows: readonly RunRow[], metric: MetricId): SurvivalCell {
  const observations = rows.map((row) => survivalObservation(row, metric)).filter((o) => o !== null);
  const curve = kaplanMeier(observations);
  return { n: curve.n, censored: curve.censored, medianMs: curve.median };
}

/**
 * One family's share of a run's items, scored like `scoreAllRuns`: a judge-skipped or no-build run
 * (no items) is 0; null only without a checklist, with a void grade or for a family not pinned.
 */
function familyScore(row: RunRow, family: GraderFamily): number | null {
  const checklist = row.checklist;
  if (!checklist || checklist.graderVoid !== null) return null;
  const tally = checklist.byFamily[family];
  if (!tally) return null;
  const items = tally.graded + tally.inconclusive;
  return items > 0 ? tally.passed / items : 0;
}

function checklistCell(rows: readonly RunRow[]): LaneRow["checklist"] {
  const byFamily = Object.values(GraderFamily).map((family): [GraderFamily, number | null] => {
    const scores = rows.map((row) => familyScore(row, family)).filter((score): score is number => score !== null);
    return [family, mean(scores)];
  });
  return {
    combined: mean(values(rows, MetricId.ScoreAllRuns)),
    byFamily: byFamily.filter(([, score]) => score !== null),
  };
}

function toolsCell(rows: readonly RunRow[]): LaneRow["tools"] {
  const covered = rows.filter((row) => row.calls.coverage === Coverage.Full);
  if (covered.length === 0) return null;
  return Object.values(ToolCategory)
    .map((category): [ToolCategory, number] => [
      category,
      median(covered.map((row) => row.calls.tools.byCategory[category] ?? 0)) ?? 0,
    ])
    .filter(([, count]) => count > 0);
}

/** A pairwise judge's pick in one order, as "which lane of the pair won". */
function orientedPick(row: PairwiseRow): PairOutcome {
  const pick = row.picks[PairFacet.Overall];
  if (row.judgeSkipped || pick === PairPick.Invalid) return PairOutcome.Invalid;
  if (pick === PairPick.Tie) return PairOutcome.Tie;
  const firstOnLeft = row.order === PairOrder.FirstLeft;
  return (pick === PairPick.Left) === firstOnLeft ? PairOutcome.First : PairOutcome.Second;
}

/** One pair's overall outcome over both orders, for one grader family. */
export interface PairResult {
  caseId: string;
  rep: number;
  family: GraderFamily;
  first: string;
  second: string;
  outcome: PairOutcome;
  /** Decided by forfeit (one side shipped no build), not by a judge. */
  forfeit: boolean;
}

/** One judged pair of runs for one family: the rows of every order and every judging pass of it. */
const pairKey = (row: PairwiseRow): string =>
  [
    row.campaignId,
    row.caseId,
    row.rep,
    row.family,
    row.lanes.first,
    row.lanes.second,
    row.runIds.first,
    row.runIds.second,
  ].join("\u0000");

/**
 * The rows of each pair's latest judging pass (its highest `gradeSeq`): a re-judge under another
 * rubric or grader model appends a pass, and orders from different passes are never compared.
 */
export function latestPairwiseRows(rows: readonly PairwiseRow[]): PairwiseRow[] {
  const latest = new Map<string, number>();
  for (const row of rows) latest.set(pairKey(row), Math.max(latest.get(pairKey(row)) ?? row.gradeSeq, row.gradeSeq));
  return rows.filter((row) => row.gradeSeq === latest.get(pairKey(row)));
}

/**
 * Combine both orders per judged pair of runs and family, from its latest judging pass only: a win
 * only when both agree; a missing order is invalid.
 */
export function pairOutcomes(rows: readonly PairwiseRow[]): PairResult[] {
  const groups = new Map<string, PairwiseRow[]>();
  for (const row of latestPairwiseRows(rows)) groups.set(pairKey(row), [...(groups.get(pairKey(row)) ?? []), row]);
  return [...groups.values()].map((group) => {
    const picks = group.map(orientedPick);
    const orders = new Set(group.map((row) => row.order));
    const [head] = group;
    const base = {
      caseId: head.caseId,
      rep: head.rep,
      family: head.family,
      first: head.lanes.first,
      second: head.lanes.second,
      forfeit: group.every((row) => row.forfeit === true),
    };
    if (orders.size < 2 || picks.includes(PairOutcome.Invalid)) return { ...base, outcome: PairOutcome.Invalid };
    const agreed = picks.every((pick) => pick === picks[0]);
    return { ...base, outcome: agreed ? picks[0] : PairOutcome.PositionInconsistent };
  });
}

/** An empty tally. */
function emptyTally(): PairTally {
  return { wins: 0, losses: 0, ties: 0, inconsistent: 0, invalid: 0, forfeitWins: 0, forfeitLosses: 0 };
}

/** Whether a result is a forfeit that was decided (both orders agreed on the side that built). */
function decidedForfeit(result: PairResult): boolean {
  return result.forfeit && (result.outcome === PairOutcome.First || result.outcome === PairOutcome.Second);
}

function tallyFor(laneId: string, results: readonly PairResult[]): PairTally {
  const tally = emptyTally();
  for (const result of results) {
    const mine = result.first === laneId ? PairOutcome.First : PairOutcome.Second;
    if (decidedForfeit(result)) {
      if (result.outcome === mine) tally.forfeitWins += 1;
      else tally.forfeitLosses += 1;
    } else if (result.outcome === mine) tally.wins += 1;
    else if (result.outcome === PairOutcome.Tie) tally.ties += 1;
    else if (result.outcome === PairOutcome.PositionInconsistent) tally.inconsistent += 1;
    else if (result.outcome === PairOutcome.Invalid) tally.invalid += 1;
    else tally.losses += 1;
  }
  return tally;
}

function pairwiseCell(laneId: string, results: readonly PairResult[]): LaneRow["pairwise"] {
  const mine = results.filter((r) => r.first === laneId || r.second === laneId);
  const siblings = [...new Set(mine.map((r) => (r.first === laneId ? r.second : r.first)))].sort();
  const sibling = siblings[0];
  if (sibling === undefined) return null;
  const withSibling = mine.filter((r) => r.first === sibling || r.second === sibling);
  const families = Object.values(GraderFamily).filter((family) => withSibling.some((r) => r.family === family));
  const byFamily = families.map((family): [GraderFamily, PairTally] => [
    family,
    tallyFor(
      laneId,
      withSibling.filter((r) => r.family === family),
    ),
  ]);
  return { sibling, byFamily };
}

function laneRow(letter: string, laneId: string, all: readonly RunRow[], pairs: readonly PairResult[]): LaneRow {
  const counted = all.filter(countsInN);
  const harness = all.filter((row) => row.outcome.harnessFailure !== null);
  const tokens = Object.fromEntries(TOKEN_KINDS.map((kind) => [kind, median(values(counted, TOKEN_METRIC[kind]))]));
  return {
    letter,
    laneId,
    n: counted.length,
    voided: all.filter((row) => row.campaignVoid !== null).length,
    harness: harness.length,
    replaced: harness.filter((row) => row.supersededBy !== null).length,
    boot: rateCell(counted, MetricId.BootRate),
    playable: rateCell(counted, MetricId.PlayableWithin30Min),
    firstPlayable: survivalCell(counted, MetricId.FirstPlayableMs),
    toDone: survivalCell(counted, MetricId.ToDoneMs),
    wallMs: median(values(counted, MetricId.WallMs)),
    tokens: tokens as Record<keyof TokenUsage, number | null>,
    leadPeakPct: median(values(counted, MetricId.LeadPeakPct)),
    tools: toolsCell(counted),
    checklist: checklistCell(counted),
    pairwise: pairwiseCell(laneId, pairs),
    apiEquivalentUsd: median(values(counted, MetricId.ApiEquivalentUsd)),
  };
}

function orderedLanes(rows: readonly RunRow[], laneOrder: readonly string[]): string[] {
  const present = new Set(rows.map((row) => row.lane.id));
  const known = laneOrder.filter((laneId) => present.has(laneId));
  const others = [...present].filter((laneId) => !laneOrder.includes(laneId)).sort();
  return [...known, ...others];
}

/** Build a campaign's scorecard from its current rows (after `currentRows()`); canary and calibration rows stay out. */
export function buildScorecard(input: ScorecardInput): Scorecard {
  const builds = input.rows.filter((row) => row.campaignId === input.campaignId && row.kind === RowKind.Build);
  const lanes = orderedLanes(builds, input.laneOrder);
  const productPairs = pairOutcomes(
    (input.pairwise ?? []).filter((row) => row.campaignId === input.campaignId && row.axis === Axis.ProductDefault),
  );
  const caseIds = [...new Set(builds.map((row) => row.case.id))].sort();
  const cases = caseIds.map((caseId): CaseCard => {
    const caseRows = builds.filter((row) => row.case.id === caseId);
    const casePairs = productPairs.filter((pair) => pair.caseId === caseId);
    const present = lanes.filter((laneId) => caseRows.some((row) => row.lane.id === laneId));
    return {
      caseId,
      caseVersion: caseRows[0].case.version,
      exposure: caseRows[0].case.exposure,
      lanes: present.map((laneId) =>
        laneRow(
          LETTERS[lanes.indexOf(laneId)] ?? "?",
          laneId,
          caseRows.filter((row) => row.lane.id === laneId),
          casePairs,
        ),
      ),
    };
  });
  const distinctCases = cases.filter((card) => card.lanes.some((lane) => lane.n > 0)).length;
  return { campaignId: input.campaignId, cases, distinctCases };
}

/** "67%, 95% CI 21–94%": a share and its Wilson interval. */
function shareWithInterval(passes: number, n: number): string {
  const { lo, hi } = wilson(passes, n);
  const pct = (value: number) => formatPercent(value * 100);
  return `${pct(passes / n)}, 95% CI ${Math.round(lo * 100)}–${pct(hi)}`;
}

/** A rate as "2/3 (67%, 95% CI 21–94%)"; no runs is "not measured". */
export function formatRate(cell: RateCell): string {
  if (cell.n === 0) return "not measured";
  return `${cell.passes}/${cell.n} (${shareWithInterval(cell.passes, cell.n)})`;
}

/** A Kaplan–Meier median with its censored count; "not reached" when survival never fell to one half. */
export function formatSurvival(cell: SurvivalCell): string {
  if (cell.n === 0) return "not measured";
  const censored = `${cell.censored} of ${cell.n} censored`;
  if (cell.medianMs === null) return `not reached (${censored})`;
  return `${formatMinutes(cell.medianMs / MINUTE_MS)} (${censored})`;
}

function formatTally(family: GraderFamily, tally: PairTally): string {
  const decided = tally.wins + tally.losses + tally.ties;
  const extras = [`${tally.ties} tie`, `${tally.inconsistent} position-inconsistent`, `${tally.invalid} invalid`];
  const forfeits = [
    tally.forfeitWins > 0 ? `${tally.forfeitWins} won by forfeit` : "",
    tally.forfeitLosses > 0 ? `${tally.forfeitLosses} lost by forfeit` : "",
  ].filter((part) => part !== "");
  const notes = forfeits.length > 0 ? `${extras.join(", ")}; ${forfeits.join(", ")}` : extras.join(", ");
  if (decided === 0) return `${family} no decided pairs (${notes})`;
  return `${family} ${tally.wins}/${decided} won (${shareWithInterval(tally.wins, decided)}; ${notes})`;
}

function formatPairwise(cell: LaneRow["pairwise"]): string {
  if (!cell) return "no pairwise";
  const families = cell.byFamily.map(([family, tally]) => formatTally(family, tally));
  return `vs ${cell.sibling}: ${families.join(DOT)}`;
}

function formatChecklist(cell: LaneRow["checklist"]): string {
  const score = (value: number | null) => (value === null ? "not graded" : formatPercent(value * 100));
  const families = cell.byFamily.map(([family, value]) => `${family} ${score(value)}`);
  return [...families, `combined ${score(cell.combined)}`].join(DOT);
}

function formatTools(tools: LaneRow["tools"]): string {
  if (tools === null) return "not measured";
  if (tools.length === 0) return "none";
  return tools.map(([category, count]) => `${category} ${count}`).join(DOT);
}

/** A Markdown table cell: pipes and newlines escaped. */
function cell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const EXPOSURE_TEXT: Record<CaseExposure, string> = {
  [CaseExposure.None]: "none",
  [CaseExposure.DevTuned]: "dev-tuned (the harness seed was iterated on this case's runs)",
};

/** The scorecard's column headers, in order. */
export const SCORECARD_COLUMNS = [
  "Lane",
  "n",
  "void · harness · replaced",
  "Boot (Wilson)",
  "Playable ≤30 min (Wilson)",
  "First playable (KM median)",
  "To done (KM median)",
  "Wall (median)",
  "Tokens uncached · cache write · cache read · output · reasoning (median)",
  "Lead context peak (median)",
  "Tool calls (median)",
  "Checklist scoreAllRuns",
  "Pairwise vs sibling (overall pick)",
  "API-equivalent (median, estimate)",
] as const;

/** One lane row's cells as text, in `SCORECARD_COLUMNS` order. */
export function laneCells(lane: LaneRow): string[] {
  const tokens = TOKEN_KINDS.map((kind) => formatMetricValue(TOKEN_METRIC[kind], lane.tokens[kind])).join(DOT);
  return [
    `${lane.letter} ${lane.laneId}`,
    String(lane.n),
    [lane.voided, lane.harness, lane.replaced].join(DOT),
    formatRate(lane.boot),
    formatRate(lane.playable),
    formatSurvival(lane.firstPlayable),
    formatSurvival(lane.toDone),
    formatMetricValue(MetricId.WallMs, lane.wallMs),
    tokens,
    formatMetricValue(MetricId.LeadPeakPct, lane.leadPeakPct),
    formatTools(lane.tools),
    formatChecklist(lane.checklist),
    formatPairwise(lane.pairwise),
    formatMetricValue(MetricId.ApiEquivalentUsd, lane.apiEquivalentUsd),
  ];
}

/** A case's heading: id, frozen version and exposure. */
export function caseHeading(card: CaseCard): string {
  return `${card.caseId}${DOT}version ${card.caseVersion}${DOT}exposure: ${EXPOSURE_TEXT[card.exposure]}`;
}

/** The footer every scorecard ends with. */
export function scorecardFooter(scorecard: Scorecard): string {
  return `Direction needs ≥${DIRECTION_FLOOR} distinct cases; this campaign has ${scorecard.distinctCases}.`;
}

/** The scorecard as Markdown. */
export function renderScorecardMarkdown(scorecard: Scorecard): string {
  const lines = [`# Scorecard${DOT}${scorecard.campaignId}`, ""];
  for (const card of scorecard.cases) {
    lines.push(`## ${cell(caseHeading(card))}`, "");
    lines.push(`| ${SCORECARD_COLUMNS.join(" | ")} |`, `|${SCORECARD_COLUMNS.map(() => "---").join("|")}|`);
    for (const lane of card.lanes) lines.push(`| ${laneCells(lane).map(cell).join(" | ")} |`);
    lines.push("");
  }
  lines.push("API-equivalent dollars are estimates (`evals/prices.json` × tokens), never billed amounts.");
  lines.push(scorecardFooter(scorecard), "");
  return lines.join("\n");
}
