/**
 * One line per run (ported from genex-demo `report/headline.ts`): case, lane, served model, how it
 * ended, the L1/L2 marks, the checklist score, the API-equivalent cost and the wall time. Rules it
 * keeps: a run with no build prints its typed reason and no L1 mark (nothing was probed, so nothing
 * failed); L2 is not scored when L1 failed; an unknown gate prints `~`, never a tick; a harness
 * failure says it is excluded from n; our rails (deadline, budget, turns, cancel) print as rail
 * stops, never as the model finishing; a missing value is a word, never a zero.
 */
import { MINUTE_MS } from "../../../src/shared/duration.ts";
import { isMeasured, type RunRow } from "../ledger/types.ts";
import { CheckResult, EndedHow, RowKind } from "../vocabulary.ts";
import { CROSS, DOT, formatMinutes, formatPercent, formatUsd, TICK } from "./compare.ts";
import { bootOutcome } from "./endpoints.ts";

/** Endings that are our rails stopping the run, not the agent deciding it was done. */
const RAIL_STOPS: ReadonlySet<EndedHow> = new Set([
  EndedHow.OwnBudget,
  EndedHow.Deadline,
  EndedHow.MaxTurns,
  EndedHow.Cancelled,
]);

/** How a run ended, in words that keep rail stops apart from agent endings. */
export function endingText(endedHow: EndedHow): string {
  if (endedHow === EndedHow.AgentFinished) return "agent finished";
  if (RAIL_STOPS.has(endedHow)) return `rail stop: ${endedHow}`;
  return `ended: ${endedHow}`;
}

function gateMark(result: CheckResult): string {
  if (result === CheckResult.Pass) return TICK;
  if (result === CheckResult.Fail) return CROSS;
  return "~";
}

function probeFields(row: RunRow): string[] {
  if (!row.probe) return ["not probed"];
  const l1 = `L1 ${gateMark(row.probe.l1Gate)}`;
  if (row.probe.l1Gate === CheckResult.Fail) return [l1, "L2 not scored"];
  const quick = row.probe.quick ? " (quick)" : "";
  return [l1, `L2 ${gateMark(row.probe.l2Gate)}${quick}`];
}

function checklistField(row: RunRow): string {
  const checklist = row.checklist;
  if (!checklist) return "checklist not graded";
  if (checklist.graderVoid !== null) return `grade void (${checklist.graderVoid})`;
  if (checklist.judgeSkipped) return "judge skipped";
  return `checklist ${formatPercent(checklist.scoreAllRuns * 100)}`;
}

function costField(row: RunRow): string {
  const usd = row.cost.apiEquivalentUsd;
  if (isMeasured(usd)) return `${formatUsd(usd)} est.`;
  return "unavailable" in usd ? `cost unavailable (${usd.reason})` : "cost n/a";
}

function timeField(row: RunRow): string {
  return row.time.wallMs === null ? "time not measured" : formatMinutes(row.time.wallMs / MINUTE_MS);
}

function outcomeFields(row: RunRow): string[] {
  if (row.outcome.harnessFailure !== null) {
    const replaced = row.supersededBy ? ` · replaced by ${row.supersededBy}` : " · not yet replaced";
    return [`harness failure: ${row.outcome.harnessFailure} (excluded from n)${replaced}`];
  }
  if (row.kind === RowKind.Canary) return [`canary ${bootOutcome(row) === 1 ? "PASS" : "FAIL"}`];
  if (row.outcome.noBuild !== null) return [endingText(row.outcome.endedHow), `no build${DOT}${row.outcome.noBuild}`];
  return [endingText(row.outcome.endedHow), ...probeFields(row), checklistField(row)];
}

/** The headline of one run. */
export function renderHeadline(row: RunRow): string {
  const head = [row.case.id, row.lane.id, row.model.main ?? "main model not reported"];
  const voidMark = row.campaignVoid === null ? [] : [`campaign void (${row.campaignVoid})`];
  return [...head, ...voidMark, ...outcomeFields(row), costField(row), timeField(row)].join(DOT);
}

/** A campaign's headlines, one per line, in `recordedAt` order. */
export function renderHeadlines(rows: readonly RunRow[]): string {
  return [...rows]
    .sort((x, y) => x.recordedAt.localeCompare(y.recordedAt))
    .map(renderHeadline)
    .join("\n");
}
