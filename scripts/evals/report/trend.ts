/**
 * Trends per metric over app builds (§11, §10.6): one lane and one case at a time (rows from
 * different lanes never average), grouped by `pins.run.appSha` in the caller's build order (Git
 * order) or, without one, by when each build first appears. Each point keeps its raw values, how
 * many runs did not measure the metric (never plotted as zero) and its median. Rows without an app
 * build (raw lanes, where the pin is n/a, or an unavailable pin) are counted as unplaced. A trend
 * across campaigns is longitudinal and labelled drift-exposed.
 */
import { isMeasured, type RunRow } from "../ledger/types.ts";
import { ResultLabel } from "../vocabulary.ts";
import { DOT } from "./compare.ts";
import { countsInN, formatMetricValue, METRICS, type MetricId } from "./endpoints.ts";
import { median } from "./stats.ts";

/** The characters of an app sha a trend prints. */
const SHORT_SHA_LENGTH = 8;

/** One app build's point. */
export interface TrendPoint {
  appSha: string;
  /** Counted runs of this build. */
  runs: number;
  values: number[];
  /** Counted runs that did not measure the metric. */
  missing: number;
  median: number | null;
  campaigns: string[];
}

/** One metric over builds for one lane and one case. */
export interface TrendSeries {
  metric: MetricId;
  laneId: string;
  caseId: string;
  points: TrendPoint[];
  /** Counted runs with no measured app build. */
  unplaced: number;
  labels: ResultLabel[];
}

/** Which slice to trend, and the build order when the caller knows it. */
export interface TrendOptions {
  laneId: string;
  caseId: string;
  /** App shas oldest first; builds not listed follow in order of first appearance. */
  appOrder?: readonly string[];
}

function buildOrder(rows: readonly RunRow[], appOrder: readonly string[]): string[] {
  const byTime = [...rows].sort((x, y) => x.recordedAt.localeCompare(y.recordedAt));
  const seen: string[] = [];
  for (const row of byTime) {
    const sha = row.pins.run.appSha;
    if (isMeasured(sha) && !seen.includes(sha)) seen.push(sha);
  }
  const known = appOrder.filter((sha) => seen.includes(sha));
  return [...known, ...seen.filter((sha) => !known.includes(sha))];
}

/** A metric's trend over app builds for one lane and one case. */
export function trendSeries(rows: readonly RunRow[], metric: MetricId, options: TrendOptions): TrendSeries {
  const read = METRICS[metric].read;
  const slice = rows.filter(
    (row) => row.lane.id === options.laneId && row.case.id === options.caseId && countsInN(row),
  );
  const placed = slice.filter((row) => isMeasured(row.pins.run.appSha));
  const points = buildOrder(placed, options.appOrder ?? []).map((appSha): TrendPoint => {
    const build = placed.filter((row) => row.pins.run.appSha === appSha);
    const measured = build.map((row) => read?.(row) ?? null).filter((value): value is number => value !== null);
    return {
      appSha,
      runs: build.length,
      values: measured,
      missing: build.length - measured.length,
      median: median(measured),
      campaigns: [...new Set(build.map((row) => row.campaignId))].sort(),
    };
  });
  const campaigns = new Set(slice.map((row) => row.campaignId));
  return {
    metric,
    laneId: options.laneId,
    caseId: options.caseId,
    points,
    unplaced: slice.length - placed.length,
    labels: campaigns.size > 1 ? [ResultLabel.Longitudinal, ResultLabel.Descriptive] : [ResultLabel.Descriptive],
  };
}

/** A trend as text: one line per build, missing runs counted, never drawn as zero. */
export function renderTrend(series: TrendSeries): string {
  const head = `${series.metric}${DOT}${series.laneId}${DOT}${series.caseId} (${series.labels.join(", ")})`;
  const lines = series.points.map((point) => {
    const value = formatMetricValue(series.metric, point.median);
    return `  ${point.appSha.slice(0, SHORT_SHA_LENGTH)}: median ${value}${DOT}${point.values.length} measured, ${point.missing} not measured`;
  });
  if (series.points.length === 0) lines.push("  no app builds with this lane and case");
  if (series.unplaced > 0)
    lines.push(`  ${series.unplaced} runs have no app build pin (raw lane or unavailable) and are not placed`);
  return [head, ...lines].join("\n");
}
