/**
 * `baseline promote --campaign <id>` (§10.4, §10.7): print the Diagnostics block, then refuse
 * unless no diagnostic is red, both canary brackets passed, no harness failure is unreplaced,
 * every cell has ≥ 3 counted runs sharing their pins, the latest calibration is green for the
 * campaign's grading pins and no grade is quick (`promoteDecision`). A campaign whose repeatability
 * sample was never re-graded is not ready (2). Otherwise one `evals/baselines/<case>.json` per
 * public case is written (raw values only, replaced whole) and formatted with `biome format
 * --write`; holdout cases gate the promotion but are only counted as withheld, never written.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { calibrationCovers, type GradingVersions, selectCalibration } from "../calibrate/run.ts";
import { canaryResults } from "../campaign/canary.ts";
import { readCalibrations } from "../grade/pipeline.ts";
import { BASELINES_DIR } from "../grade/regrade.ts";
import type { CalibrationResult } from "../grade/types.ts";
import type { EvalsPaths } from "../ledger/paths.ts";
import { CAMPAIGN_ID_PATTERN, isMeasured, type RunRow } from "../ledger/types.ts";
import { baselineJson, type BaselineFile, promoteDecision } from "../report/baseline.ts";
import { countsInN } from "../report/endpoints.ts";
import { parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { campaignHealth, printDiagnostics, repeatabilityMissing } from "./diagnostics.ts";
import { CliExit, type Out } from "./exit.ts";

const MESSAGE = {
  usage: "usage: baseline promote --campaign <id>",
  noRows: "not-ready no-rows",
  diagnosticsRed: "refused diagnostics-red",
  repeatability:
    "not-ready grader-repeatability: first run `npm run eval -- diagnostics <campaign> --repeatability --live`",
  refused: "refused",
  wrote: "wrote",
  withheldHoldouts: "withheld-holdouts",
  formatFailed: "failed format",
} as const;

const CAMPAIGN_FLAG = "--campaign";

/** The grading versions a row was graded under, or null when one of them was not recorded. */
function versionsOf(row: RunRow): GradingVersions | null {
  const { proberVersion, graderPromptSha, graderModels } = row.pins.grading;
  if (!isMeasured(proberVersion) || !isMeasured(graderPromptSha)) return null;
  return { proberVersion, graderPromptSha, graderModels, quick: row.probe?.quick === true };
}

/** Whether the calibration that decides a grade under these versions is green; unrecorded versions never are. */
function greenFor(lines: readonly CalibrationResult[], versions: GradingVersions | null): boolean {
  if (versions === null) return false;
  const deciding = selectCalibration(lines, versions);
  return deciding !== null && calibrationCovers(deciding, versions);
}

/** Whether, for every grading version the campaign's counted runs carry, the calibration that decides it is green. */
async function calibrationGreen(paths: EvalsPaths, rows: readonly RunRow[]): Promise<boolean> {
  const lines = await readCalibrations(paths);
  return rows.filter(countsInN).every((row) => greenFor(lines, versionsOf(row)));
}

/** Write each baseline whole (a temp file renamed over the old one); answers the files. */
async function writeBaselines(root: string, baselines: readonly BaselineFile[]): Promise<string[]> {
  const dir = path.join(root, BASELINES_DIR);
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const baseline of baselines) {
    const file = path.join(dir, `${baseline.caseId}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(temp, baselineJson(baseline), { flag: "wx" });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
    files.push(file);
  }
  return files;
}

/** The campaign id from `--campaign <id>`, or null. */
function campaignOf(args: readonly string[]): string | null {
  const parsed = parseCliArgs(args, { values: [CAMPAIGN_FLAG] });
  const campaignId = parsed?.values.get(CAMPAIGN_FLAG);
  const usable = parsed !== null && parsed.positional.length === 0 && campaignId !== undefined;
  return usable && CAMPAIGN_ID_PATTERN.test(campaignId) ? campaignId : null;
}

/** Every reason the campaign may not be promoted, as printed lines; the baselines when there is none. */
async function decide(ctx: CliContext, campaignId: string, rows: readonly RunRow[], blocking: readonly string[]) {
  const canaries = canaryResults(rows);
  const decision = promoteDecision({
    campaignId,
    rows,
    openingCanary: canaries.opening,
    closingCanary: canaries.closing,
    calibrationGreen: await calibrationGreen(ctx.paths, rows),
    promotedAt: ctx.now().toISOString(),
  });
  const refusals = blocking.length > 0 ? [`${MESSAGE.diagnosticsRed} ${blocking.join(", ")}`] : [];
  if (!decision.ok) {
    refusals.push(...decision.refusals.map((r) => `${MESSAGE.refused} ${r.code} ${r.detail}`));
    return { refusals, baselines: [], withheldHoldouts: 0 };
  }
  return { refusals, baselines: decision.baselines, withheldHoldouts: decision.withheldHoldouts };
}

/** The `baseline promote` command handler. */
export async function baselinePromoteCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  const campaignId = campaignOf(args);
  if (campaignId === null) {
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
  const { refusals, baselines, withheldHoldouts } = await decide(ctx, campaignId, rows, block.blocking);
  for (const line of refusals) out(line);
  if (refusals.length > 0) return CliExit.Refused;
  if (repeatabilityMissing(block)) {
    out(MESSAGE.repeatability);
    return CliExit.NotReady;
  }
  const files = await writeBaselines(ctx.root, baselines);
  try {
    await ctx.formatJson(files);
  } catch {
    out(`${MESSAGE.formatFailed} ${files.join(" ")}`);
    return CliExit.Refused;
  }
  for (const file of files) out(`${MESSAGE.wrote} ${file}`);
  if (withheldHoldouts > 0) out(`${MESSAGE.withheldHoldouts} ${withheldHoldouts}`);
  return CliExit.Ok;
}
