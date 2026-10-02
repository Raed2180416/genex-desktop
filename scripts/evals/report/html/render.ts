/**
 * The local ledger explorer (`report --html`, §11): one static, self-contained page with no
 * dependency and no network. It shows every local row with filters (campaign, case, lane, kind,
 * and whether harness-failure and void rows are shown), the scorecard of the chosen campaign, and a
 * trend per metric over app builds. Rows are projected to codes and numbers first; a missing
 * measurement stays null and prints as "not measured", never as zero. All markup the server writes
 * is escaped, and the data travels in a JSON block that cannot close its script element.
 */
import type { PairwiseRow, RunRow } from "../../ledger/types.ts";
import { isMeasured } from "../../ledger/types.ts";
import { EndedHow, RowKind } from "../../vocabulary.ts";
import { MetricKind, METRICS, MetricId, type MetricUnit } from "../endpoints.ts";
import { buildScorecard } from "../scorecard.ts";
import { EXPLORER_SCRIPT } from "./client.ts";
import { escapeHtml, jsonForScript } from "./escape.ts";
import { renderScorecardHtml } from "./scorecard.ts";
import { EXPLORER_CSS } from "./styles.ts";

/** The metric columns of the runs table. */
export const EXPLORER_TABLE_METRICS: readonly MetricId[] = [
  MetricId.BootRate,
  MetricId.PlayableWithin30Min,
  MetricId.ScoreAllRuns,
  MetricId.WallMs,
  MetricId.FirstPlayableMs,
  MetricId.Output,
  MetricId.ApiEquivalentUsd,
];

/** One row as the page sees it: codes, ids and numbers only. */
export interface ExplorerRun {
  runId: string;
  campaignId: string;
  recordedAt: string;
  kind: RowKind;
  caseId: string;
  laneId: string;
  appSha: string | null;
  endedHow: EndedHow;
  harnessFailure: string | null;
  noBuild: string | null;
  campaignVoid: string | null;
  metrics: Partial<Record<MetricId, number | null>>;
}

/** The embedded data block. */
export interface ExplorerData {
  runs: ExplorerRun[];
  metrics: { id: MetricId; unit: MetricUnit; trend: boolean }[];
  columns: readonly MetricId[];
  defaultCampaign: string | null;
  codes: { agentFinished: EndedHow; build: RowKind };
}

/** What the page is built from. */
export interface ExplorerInput {
  rows: readonly RunRow[];
  pairwise?: readonly PairwiseRow[];
  laneOrder: readonly string[];
  generatedAt: string;
}

const READABLE_METRICS = Object.values(METRICS).filter((metric) => metric.read !== null);

function projectRun(row: RunRow): ExplorerRun {
  const appSha = row.pins.run.appSha;
  return {
    runId: row.runId,
    campaignId: row.campaignId,
    recordedAt: row.recordedAt,
    kind: row.kind,
    caseId: row.case.id,
    laneId: row.lane.id,
    appSha: isMeasured(appSha) ? appSha : null,
    endedHow: row.outcome.endedHow,
    harnessFailure: row.outcome.harnessFailure,
    noBuild: row.outcome.noBuild,
    campaignVoid: row.campaignVoid,
    metrics: Object.fromEntries(READABLE_METRICS.map((metric) => [metric.id, metric.read?.(row) ?? null])),
  };
}

function latestCampaign(rows: readonly RunRow[]): string | null {
  const latest = [...rows].sort((x, y) => y.recordedAt.localeCompare(x.recordedAt))[0];
  return latest?.campaignId ?? null;
}

/** The page's data: every row projected, the metric table, and the campaign shown first. */
export function explorerData(rows: readonly RunRow[]): ExplorerData {
  return {
    runs: [...rows].sort((x, y) => x.recordedAt.localeCompare(y.recordedAt)).map(projectRun),
    metrics: READABLE_METRICS.map((metric) => ({
      id: metric.id,
      unit: metric.unit,
      trend: metric.kind !== MetricKind.Pairwise,
    })),
    columns: EXPLORER_TABLE_METRICS,
    defaultCampaign: latestCampaign(rows),
    codes: { agentFinished: EndedHow.AgentFinished, build: RowKind.Build },
  };
}

function select(id: string, label: string): string {
  return `<label for="${id}">${escapeHtml(label)}<select id="${id}"></select></label>`;
}

function runsTableHead(): string {
  const fixed = ["Run", "Campaign", "Case", "Lane", "Kind", "Outcome"];
  const cells = [...fixed, ...EXPLORER_TABLE_METRICS].map((name) => `<th scope="col">${escapeHtml(name)}</th>`);
  return `<tr>${cells.join("")}</tr>`;
}

/** The whole page. */
export function renderLedgerHtml(input: ExplorerInput): string {
  const campaigns = [...new Set(input.rows.map((row) => row.campaignId))].sort();
  const scorecards = campaigns.map((campaignId) =>
    renderScorecardHtml(
      buildScorecard({ campaignId, rows: input.rows, pairwise: input.pairwise, laneOrder: input.laneOrder }),
    ),
  );
  const note = `Generated ${input.generatedAt} · ${input.rows.length} rows from the local ledger. A missing measurement prints as “not measured”, never as zero; harness-failure and void rows are hidden unless shown.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval ledger</title>
<style>${EXPLORER_CSS}</style>
</head>
<body>
<main>
<h1>Eval ledger</h1>
<p class="note">${escapeHtml(note)}</p>
<div class="filters">
${select("f-campaign", "Campaign")}
${select("f-case", "Case")}
${select("f-lane", "Lane")}
${select("f-kind", "Kind")}
${select("f-metric", "Trend metric")}
<label for="f-excluded"><span>Show harness failures and void rows</span><input type="checkbox" id="f-excluded"></label>
</div>
<h2>Scorecard</h2>
${scorecards.join("\n") || '<p class="note">No campaigns in the ledger.</p>'}
<h2>Trend per metric over app builds</h2>
<p class="note">One lane and one case per chart, across campaigns (longitudinal, drift-exposed). Builds without a measurement show no point.</p>
<div id="trend" class="trend"></div>
<h2>Runs</h2>
<p id="run-count" class="note"></p>
<div class="table-wrap"><table><thead>${runsTableHead()}</thead><tbody id="runs-body"></tbody></table></div>
<script type="application/json" id="ledger-data">${jsonForScript(explorerData(input.rows))}</script>
<script>${EXPLORER_SCRIPT}</script>
</main>
</body>
</html>
`;
}
