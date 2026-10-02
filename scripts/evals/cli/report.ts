/**
 * `report <campaign> [--md | --html | --trend [--metric m]]` (§11): the scorecard as Markdown (the
 * default), the self-contained ledger explorer written under `$GENEX_EVALS_HOME/reports/`, or each
 * of the campaign's cells trended over app builds across the whole local ledger. Every form prints
 * the §10.7 Diagnostics block first and exits 1 while a diagnostic is red; a campaign with no rows
 * is not ready (2).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { currentRows, readPairwiseRows, readRunRows } from "../ledger/read.ts";
import type { RunRow } from "../ledger/types.ts";
import { countsInN, METRICS, MetricId } from "../report/endpoints.ts";
import { renderLedgerHtml } from "../report/html/render.ts";
import { buildScorecard, renderScorecardMarkdown } from "../report/scorecard.ts";
import { renderTrend, trendSeries } from "../report/trend.ts";
import { campaignIdOf, parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { campaignHealth, printDiagnostics } from "./diagnostics.ts";
import { CliExit, type Out } from "./exit.ts";

/** Where `report --html` writes, under the evals home. */
export const REPORTS_DIR = "reports";

const MESSAGE = {
  usage: "usage: report <campaign> [--md | --html | --trend [--metric <metric>]]",
  noRows: "not-ready no-rows",
  wrote: "wrote",
} as const;

const FORMATS = ["--md", "--html", "--trend"] as const;
const METRIC_FLAG = "--metric";

/** A metric a trend can read from a single run. */
function trendMetric(value: string | undefined): MetricId | null {
  if (value === undefined) return MetricId.BootRate;
  const metric = Object.values(MetricId).find((id) => id === value);
  return metric !== undefined && METRICS[metric].read !== null ? metric : null;
}

/** The (case, lane) cells the campaign's counted runs fall in, sorted. */
function cellsOf(rows: readonly RunRow[]): Array<{ caseId: string; laneId: string }> {
  const keys = new Set(rows.filter(countsInN).map((row) => `${row.case.id}\n${row.lane.id}`));
  return [...keys].sort().map((key) => {
    const [caseId = "", laneId = ""] = key.split("\n");
    return { caseId, laneId };
  });
}

/** Write the ledger explorer for every local row; answers the file. */
async function writeExplorer(ctx: CliContext, campaignId: string): Promise<string> {
  const rows = currentRows(await readRunRows(ctx.paths));
  const html = renderLedgerHtml({
    rows,
    pairwise: await readPairwiseRows(ctx.paths),
    laneOrder: ctx.registry().lanes.map((lane) => lane.id),
    generatedAt: ctx.now().toISOString(),
  });
  const file = path.join(ctx.paths.home, REPORTS_DIR, `${campaignId}.html`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  return file;
}

/** Print each of the campaign's cells trended over app builds, across every local campaign. */
async function printTrends(ctx: CliContext, campaignRows: readonly RunRow[], metric: MetricId, out: Out) {
  const all = currentRows(await readRunRows(ctx.paths));
  for (const { caseId, laneId } of cellsOf(campaignRows))
    for (const line of renderTrend(trendSeries(all, metric, { caseId, laneId })).split("\n")) out(line);
}

/** Print the Markdown scorecard of one campaign. */
async function printScorecard(ctx: CliContext, campaignId: string, rows: readonly RunRow[], out: Out) {
  const scorecard = buildScorecard({
    campaignId,
    rows,
    pairwise: await readPairwiseRows(ctx.paths),
    laneOrder: ctx.registry().lanes.map((lane) => lane.id),
  });
  for (const line of renderScorecardMarkdown(scorecard).split("\n")) out(line);
}

/** The `report` command handler. */
export async function reportCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  const parsed = parseCliArgs(args, { switches: FORMATS, values: [METRIC_FLAG] });
  const campaignId = campaignIdOf(parsed);
  const formats = FORMATS.filter((flag) => parsed?.switches.has(flag));
  const metric = trendMetric(parsed?.values.get(METRIC_FLAG));
  const metricMisplaced = parsed?.values.has(METRIC_FLAG) === true && !formats.includes("--trend");
  const usable = campaignId !== null && formats.length <= 1 && metric !== null && !metricMisplaced;
  if (!usable) {
    out(MESSAGE.usage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  const { rows, block } = await campaignHealth(ctx.paths, campaignId);
  if (rows.length === 0) {
    out(`${MESSAGE.noRows} ${campaignId}`);
    return CliExit.NotReady;
  }
  printDiagnostics(block, out);
  if (formats.includes("--html")) out(`${MESSAGE.wrote} ${await writeExplorer(ctx, campaignId)}`);
  else if (formats.includes("--trend")) await printTrends(ctx, rows, metric, out);
  else await printScorecard(ctx, campaignId, rows, out);
  return block.blocking.length > 0 ? CliExit.Refused : CliExit.Ok;
}
