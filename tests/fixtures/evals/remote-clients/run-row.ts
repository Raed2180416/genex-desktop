/**
 * A synthetic `genex-evals/run/1` row for the remote-client tests: every value is invented, every
 * string is a code or matches its pattern, and nothing comes from a real run.
 */
import { EndedHow, ZERO_TOKEN_USAGE } from "../../../../src/shared/eval-lane.ts";
import { EngineId } from "../../../../src/shared/providers.ts";
import { NOT_APPLICABLE, RUN_ROW_SCHEMA, type RunRow } from "../../../../scripts/evals/ledger/types.ts";
import {
  AccountExclusive,
  BrowserPin,
  CaseExposure,
  CaseVisibility,
  CheckResult,
  Concurrency,
  ContainmentPin,
  Coverage,
  EvalAgent,
  HardwareClass,
  LaneMode,
  NetworkPin,
  RowKind,
  ShimMode,
} from "../../../../scripts/evals/vocabulary.ts";

/** The campaign every synthetic row belongs to. */
export const CAMPAIGN = "20261001T120000-remote-fixture";

/** A synthetic run id for rep `rep` of a fixture case. */
export const runIdFor = (rep: number, caseId = "fixture-case"): string =>
  `20261001T120000-fixture-lane-${caseId}-r${rep}`;

/** One synthetic run row; `patch` replaces top-level fields. */
export function syntheticRow(patch: Partial<RunRow> = {}): RunRow {
  return {
    schema: RUN_ROW_SCHEMA,
    runId: runIdFor(1),
    campaignId: CAMPAIGN,
    recordedAt: "2026-10-01T12:30:00Z",
    gradeSeq: 0,
    gradeId: "0123456789ab",
    kind: RowKind.Build,
    campaignVoid: null,
    supersededBy: null,
    case: {
      id: "fixture-case",
      version: "aaaaaaaaaaaa",
      checklistVersion: "bbbbbbbbbbbb",
      exposure: CaseExposure.None,
      visibility: CaseVisibility.Public,
    },
    lane: {
      id: "fixture-lane",
      agent: EvalAgent.ClaudeCli,
      engine: EngineId.ClaudeCode,
      mode: LaneMode.RawCli,
      modeServed: null,
      harnessPin: "cccccccccccc",
      network: NetworkPin.AutoClassifier,
      browser: BrowserPin.None,
      containment: ContainmentPin.Fixture,
    },
    model: { requested: "fixture", main: "fixture", served: [], effort: "high", effortServed: "high" },
    pins: {
      run: {
        appSha: NOT_APPLICABLE,
        buildId: NOT_APPLICABLE,
        harnessSeedDigest: NOT_APPLICABLE,
        cliVersion: "1.0.0",
        laneWrapperDigest: "dddddddddddd",
        containmentDigest: "eeeeeeeeeeee",
        instructionSha: "ffffffffffff",
      },
      grading: {
        proberVersion: NOT_APPLICABLE,
        soakMs: NOT_APPLICABLE,
        graderPromptSha: NOT_APPLICABLE,
        graderModels: [],
        pairwiseRubricSha: NOT_APPLICABLE,
        shimMode: ShimMode.None,
        rendererMode: NOT_APPLICABLE,
        endpointsSha: "121212121212",
      },
      recorded: {
        evalSha: "3434343434343434343434343434343434343434",
        appDirty: false,
        os: "darwin-25.6.0",
        hardwareClass: HardwareClass.AppleSilicon,
        concurrency: Concurrency.Serial,
        coRunLane: null,
        interleaveSeed: "5656565656565656",
        accountExclusive: AccountExclusive.Unattested,
      },
    },
    outcome: {
      endedHow: EndedHow.AgentFinished,
      harnessFailure: null,
      noBuild: null,
      questionsAsked: 0,
      answersGiven: 0,
      traceComplete: { parseFailures: 0, truncatedTail: false },
      providerNoise: { apiErrors: 0, retries: 0, apiErrorStatus: null },
    },
    time: {
      wallMs: 1000,
      toDoneMs: 1000,
      firstBootMs: null,
      firstPlayableMs: null,
      firstPlayableResolutionMs: null,
      firstPreviewMs: null,
      delegationP50Ms: null,
      builds: [],
      coverage: Coverage.Full,
    },
    tokens: { ...ZERO_TOKEN_USAGE, byRole: {}, byModel: {}, coverage: Coverage.Full },
    context: { leadPeakPct: null, leadPeakTokens: null, workersPeakPct: null, compactions: null, coverage: Coverage.Full },
    calls: {
      modelCalls: 1,
      tools: { total: 0, byCategory: {} },
      blindEditStreak: null,
      subagents: null,
      verifiedBeforeDone: null,
      coverage: Coverage.Full,
    },
    cost: { apiEquivalentUsd: 0, priceTable: "2026-09-25", cliReportedUsd: null, billed: null, quota: [] },
    output: { files: 1, bytes: 10, loc: 1, hasEntry: true, buildScript: false, validate: CheckResult.Unknown },
    probe: null,
    checklist: null,
    inApp: null,
    digests: { streamSha256: null, transcriptSha256: null, snapshotSha256: null, evidenceSha256: null },
    notes: [],
    ...patch,
  };
}
