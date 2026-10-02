/**
 * Graded ledgers for the CLI tests: rows of the grading fixture's case, graded (full or quick) with
 * a boot verdict, on an app build or none, plus canaries, a campaign plan with its apps, a green
 * calibration and a repeatability sample. Everything is written through the real ledger writer
 * into a temp evals home; a `CliContext` binds that home and a temp repository root.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppRole } from "../../../../scripts/evals/campaign/types.ts";
import type { CliContext } from "../../../../scripts/evals/cli/context.ts";
import { REPO_ROOT } from "../../../../scripts/evals/cli/context.ts";
import { repeatabilityFile } from "../../../../scripts/evals/grade/commands.ts";
import type { RepeatabilityObservation } from "../../../../scripts/evals/grade/diagnostics.ts";
import { recordCalibration } from "../../../../scripts/evals/grade/pipeline.ts";
import { readLaneRegistry } from "../../../../scripts/evals/lanes/registry.ts";
import { type EvalsPaths, evalsPaths } from "../../../../scripts/evals/ledger/paths.ts";
import { type RowLane, type RunRow, unavailable } from "../../../../scripts/evals/ledger/types.ts";
import { appendLedgerRow, withGradeId } from "../../../../scripts/evals/ledger/write.ts";
import { PROBER_VERSION } from "../../../../scripts/evals/prober/types.ts";
import { ENDPOINTS_SHA } from "../../../../scripts/evals/report/endpoints.ts";
import { defaultHomes } from "../../../../scripts/transcript-census.ts";
import { CHECKLIST_PROMPT_SHA } from "../../../../scripts/evals/grade/checklist/prompt.ts";
import {
  CheckResult,
  GraderFamily,
  ItemVerdict,
  NoteCode,
  RendererMode,
  RowKind,
  UnavailableReason,
} from "../../../../scripts/evals/vocabulary.ts";
import { tmpDir } from "../../../helpers/tmp.ts";
import { CAMPAIGN, collectedRow, GRADERS, GREEN, gradingCase, LANES, runIdOf } from "../grading/campaign.ts";

/** The base and candidate app builds of a version-axis campaign. */
export const BASE_SHA = "b".repeat(40);
export const CAND_SHA = "c".repeat(40);
/** The soak a full grade pins. */
const FULL_SOAK_MS = 300_000;

/** What one graded row varies by. */
export interface GradedSpec {
  lane: RowLane;
  rep: number;
  /** The L1 verdict; null leaves the run unprobed. */
  boots: boolean | null;
  appSha?: string;
  quick?: boolean;
  /** An API error on the trace: plumbing noise (§10.7). */
  apiError?: boolean;
  recordedAt?: string;
}

/** A graded (`gradeSeq` 2) row of the grading fixture's case. */
export function gradedRow(spec: GradedSpec): RunRow {
  const row = collectedRow({ lane: spec.lane, rep: spec.rep });
  const quick = spec.quick === true;
  const soakMs = quick ? unavailable(UnavailableReason.ProbeSkipped) : FULL_SOAK_MS;
  const verdict = spec.boots ? CheckResult.Pass : CheckResult.Fail;
  const app = spec.appSha ? { appSha: spec.appSha, buildId: spec.appSha, harnessSeedDigest: "d".repeat(12) } : {};
  return withGradeId({
    ...row,
    gradeSeq: 2,
    recordedAt: spec.recordedAt ?? `2026-10-01T14:${String(spec.rep).padStart(2, "0")}:00Z`,
    probe:
      spec.boots === null
        ? null
        : {
            l1Gate: verdict,
            l2Gate: verdict,
            rows: {},
            firstRenderMs: spec.boots ? 800 : null,
            fpsMedian: null,
            consoleErrors: 0,
            soakMs,
            quick,
          },
    pins: {
      ...row.pins,
      run: { ...row.pins.run, ...app },
      grading: {
        ...row.pins.grading,
        proberVersion: PROBER_VERSION,
        soakMs,
        graderPromptSha: CHECKLIST_PROMPT_SHA,
        graderModels: GRADERS.map((pin) => pin.model),
        rendererMode: RendererMode.Gpu,
        endpointsSha: ENDPOINTS_SHA,
      },
    },
    outcome: {
      ...row.outcome,
      providerNoise: { apiErrors: spec.apiError ? 1 : 0, retries: 0, apiErrorStatus: spec.apiError ? 529 : null },
    },
    notes: quick ? [NoteCode.QuickGrade] : [],
  });
}

/** A canary row of one lane: rep 1 opens, rep 3 closes (`CANARY_REP`). */
export function canaryRow(lane: RowLane, rep: 1 | 2 | 3, boots: boolean): RunRow {
  const graded = gradedRow({ lane, rep, boots });
  return withGradeId({
    ...graded,
    runId: runIdOf(lane, rep, "canary"),
    kind: RowKind.Canary,
    case: { ...graded.case, id: "canary" },
  });
}

/** A temp evals home and repository root, and a CLI context over them. */
export interface CliWorld {
  paths: EvalsPaths;
  root: string;
  ctx: CliContext;
  userHome: string;
  lines: string[];
  out: (line: string) => void;
}

/** A fresh world; `patch` overrides any part of the context. */
export async function cliWorld(patch: Partial<CliContext> = {}): Promise<CliWorld> {
  const home = await tmpDir("eval-cli-home-");
  const root = await tmpDir("eval-cli-root-");
  const userHome = await tmpDir("eval-cli-user-");
  const lanes = await tmpDir("eval-cli-lanes-");
  const paths = evalsPaths(home);
  const lines: string[] = [];
  const ctx: CliContext = {
    paths,
    root,
    lanes,
    cases: () => [gradingCase],
    registry: () => readLaneRegistry(REPO_ROOT),
    now: () => new Date("2026-10-02T00:00:00Z"),
    formatJson: async () => {},
    ...patch,
  };
  return { paths, root, ctx, userHome, lines, out: (line) => void lines.push(line) };
}

/** Append rows through the real writer. */
export async function seedRows(world: CliWorld, rows: readonly RunRow[]): Promise<void> {
  for (const row of rows) await appendLedgerRow(row, { paths: world.paths, homes: defaultHomes(world.userHome) });
}

/** The fixture campaign's plan file, with its apps (only what `check` reads). */
export async function writePlan(world: CliWorld, apps: { base: string; cand: string } | null): Promise<void> {
  const dir = path.join(world.paths.campaigns, CAMPAIGN);
  await mkdir(dir, { recursive: true });
  const planned = apps
    ? [
        { role: AppRole.Base, sha: apps.base },
        { role: AppRole.Candidate, sha: apps.cand },
      ]
    : [];
  const plan = { schema: "genex-evals/campaign/1", campaignId: CAMPAIGN, streams: [], apps: planned };
  await writeFile(path.join(dir, "campaign.json"), JSON.stringify(plan));
}

/** A green calibration for exactly the pins `gradedRow` carries. */
export async function recordGreen(world: CliWorld): Promise<void> {
  await recordCalibration(world.paths, GREEN);
}

/** A kept repeatability sample of `n` items per family; `flip` of them disagree with themselves. */
export async function writeRepeatability(world: CliWorld, n: number, flip = 0): Promise<void> {
  const observations: RepeatabilityObservation[] = [GraderFamily.Claude, GraderFamily.Gpt].flatMap((family) =>
    Array.from({ length: n }, (_, index) => ({
      runId: runIdOf(LANES.a, index + 1),
      itemId: `${gradingCase.id}-0${index + 1}`,
      family,
      first: ItemVerdict.Pass,
      again: index < flip ? ItemVerdict.Fail : ItemVerdict.Pass,
    })),
  );
  const file = repeatabilityFile(world.paths, CAMPAIGN);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(observations));
}
