/**
 * The Diagnostics block (§10.7) as `report`, `check` and `baseline promote` run it before any claim:
 * a campaign's current grades, the items their grade records hold and the kept repeatability
 * sample, through `runDiagnostics`. A red diagnostic blocks promotion and withholds a clear verdict;
 * a repeatability sample that was never re-graded is not ready for promotion.
 */
import { campaignGrades, readRepeatability } from "../grade/commands.ts";
import { DiagnosticId, type Diagnostics, renderDiagnostics, runDiagnostics } from "../grade/diagnostics.ts";
import type { EvalsPaths } from "../ledger/paths.ts";
import type { RunRow } from "../ledger/types.ts";
import type { Axis } from "../vocabulary.ts";
import type { Out } from "./exit.ts";

/** A campaign's current rows and its Diagnostics block. */
export interface CampaignHealth {
  rows: RunRow[];
  block: Diagnostics;
}

/** Run the diagnostics over a campaign's current grades and its kept repeatability sample. */
export async function campaignHealth(
  paths: EvalsPaths,
  campaignId: string,
  axes?: readonly Axis[],
): Promise<CampaignHealth> {
  const { rows, items } = await campaignGrades(paths, campaignId);
  const repeatability = await readRepeatability(paths, campaignId);
  return { rows, block: runDiagnostics({ rows, items, repeatability, ...(axes ? { axes } : {}) }) };
}

/** Print the block, one line at a time. */
export function printDiagnostics(block: Diagnostics, out: Out): void {
  for (const line of renderDiagnostics(block).split("\n")) out(line);
}

/** Whether promotion must wait for `diagnostics <campaign> --repeatability`: the sample was never re-graded. */
export function repeatabilityMissing(block: Diagnostics): boolean {
  return block.notRun.includes(DiagnosticId.GraderRepeatability);
}
