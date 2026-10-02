/**
 * `compare --axis <axis> --a <campaign>:<lane>[@<appSha>] --b <campaign>:<lane>[@<appSha>]` (§10):
 * two arms of counted runs from the local ledger, refused unless they differ only on the axis's
 * pins (`armsRefusal`), then the axis's pre-registered primary and its secondaries, each compared
 * across cases (n = distinct cases both arms ran: < 5 refuses, 5–7 a direction, ≥ 8 a magnitude),
 * with the axis's labels; a rate pools each case's pass counts (Mantel–Haenszel, Wilson per arm)
 * instead of taking medians of 0/1 values. An arm with no runs is not ready.
 */
import { currentRows, readRunRows } from "../ledger/read.ts";
import { CAMPAIGN_ID_PATTERN, isMeasured, type RunRow, SLUG_PATTERN } from "../ledger/types.ts";
import { armsRefusal } from "../report/comparability.ts";
import {
  type CaseValue,
  compareCases,
  compareRateCases,
  renderComparison,
  renderRateComparison,
} from "../report/compare.ts";
import { axisLabels, countsInN, ENDPOINTS, METRICS, MetricKind, type MetricId } from "../report/endpoints.ts";
import { Axis } from "../vocabulary.ts";
import { parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { CliExit, type Out } from "./exit.ts";

const MESSAGE = {
  usage: "usage: compare --axis <axis> --a <campaign>:<lane>[@<appSha>] --b <campaign>:<lane>[@<appSha>]",
  emptyArm: "not-ready empty-arm",
  refused: "refused incomparable",
  primary: "Primary",
  secondary: "Secondary",
  notPerRun: "is a campaign-level metric: see the scorecard",
  labels: "labels:",
} as const;

/** A hex app sha, 7–40 characters. */
const APP_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** One arm as the command line names it. */
export interface ArmSpec {
  label: "A" | "B";
  campaignId: string;
  laneId: string;
  /** A prefix of the app build's sha, or null for every build. */
  appSha: string | null;
}

/** `<campaign>:<lane>[@<appSha>]`, or null when any part is malformed. */
export function parseArm(text: string, label: ArmSpec["label"]): ArmSpec | null {
  const [cell = "", appSha = null] = text.split("@");
  const [campaignId = "", laneId = "", ...extra] = cell.split(":");
  const valid =
    extra.length === 0 &&
    CAMPAIGN_ID_PATTERN.test(campaignId) &&
    SLUG_PATTERN.test(laneId) &&
    (appSha === null || APP_SHA_PATTERN.test(appSha));
  return valid ? { label, campaignId, laneId, appSha } : null;
}

/** The counted current runs one arm names. */
function armRows(rows: readonly RunRow[], arm: ArmSpec): RunRow[] {
  return rows.filter((row) => {
    const sha = row.pins.run.appSha;
    const build = arm.appSha === null || (isMeasured(sha) && sha.startsWith(arm.appSha));
    return row.campaignId === arm.campaignId && row.lane.id === arm.laneId && build && countsInN(row);
  });
}

/** One run's value of a metric per case, measured runs only. */
function caseValues(rows: readonly RunRow[], metric: MetricId): CaseValue[] {
  const read = METRICS[metric].read;
  if (read === null) return [];
  return rows.flatMap((row) => {
    const value = read(row);
    return value === null ? [] : [{ caseId: row.case.id, value }];
  });
}

/** Print one metric's comparison block. */
function printMetric(metric: MetricId, heading: string, a: readonly RunRow[], b: readonly RunRow[], out: Out) {
  const spec = METRICS[metric];
  if (spec.read === null) {
    out(`${heading} ${metric} ${MESSAGE.notPerRun}`);
    return;
  }
  const options = { labelA: "A", labelB: "B", metric, betterIs: spec.betterIs, scale: spec.scale };
  const [valuesA, valuesB] = [caseValues(a, metric), caseValues(b, metric)];
  const block =
    spec.kind === MetricKind.Rate
      ? renderRateComparison(compareRateCases(valuesA, valuesB, options), options)
      : renderComparison(compareCases(valuesA, valuesB, options), options);
  out(heading);
  for (const line of block.split("\n")) out(line);
}

/** The parsed command line, or null for bad usage. */
function parseCompare(args: readonly string[]): { axis: Axis; a: ArmSpec; b: ArmSpec } | null {
  const parsed = parseCliArgs(args, { values: ["--axis", "--a", "--b"] });
  if (parsed === null || parsed.positional.length > 0) return null;
  const axis = Object.values(Axis).find((value) => value === parsed.values.get("--axis"));
  const a = parseArm(parsed.values.get("--a") ?? "", "A");
  const b = parseArm(parsed.values.get("--b") ?? "", "B");
  return axis !== undefined && a !== null && b !== null ? { axis, a, b } : null;
}

/** The `compare` command handler. */
export async function compareCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  const request = parseCompare(args);
  if (request === null) {
    out(MESSAGE.usage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  const rows = currentRows(await readRunRows(ctx.paths));
  const armA = armRows(rows, request.a);
  const armB = armRows(rows, request.b);
  const empty = [armA.length === 0 ? request.a.label : "", armB.length === 0 ? request.b.label : ""].filter(Boolean);
  if (empty.length > 0) {
    out(`${MESSAGE.emptyArm} ${empty.join(",")}`);
    return CliExit.NotReady;
  }
  const refusal = armsRefusal(armA, armB, request.axis);
  if (refusal) {
    out(`${MESSAGE.refused}: ${refusal.text}`);
    return CliExit.Refused;
  }
  const endpoint = ENDPOINTS[request.axis];
  out(`${request.axis}: ${endpoint.label}`);
  const sameCampaign = request.a.campaignId === request.b.campaignId;
  const labels = axisLabels(request.axis, { sameCampaign, neutralGrader: false });
  if (labels.length > 0) out(`${MESSAGE.labels} ${labels.join(", ")}`);
  printMetric(endpoint.primary, `${MESSAGE.primary} ${endpoint.primary}`, armA, armB, out);
  for (const metric of endpoint.secondaries) printMetric(metric, `${MESSAGE.secondary} ${metric}`, armA, armB, out);
  return CliExit.Ok;
}
