/**
 * The eval-health diagnostics (§10.7) over known vectors: grader repeatability (a seeded sample,
 * disagreement per family, red above 10%), plumbing (red above 5% of a cell), headroom (saturated at
 * ≥95% for every lane), always-failing items (≥6 runs), the noise floor against the owner's
 * smallest actionable change, and scaling sanity for an effort-low twin. The Diagnostics block
 * names what blocks promotion.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alwaysFailingItems,
  DiagnosticFlag,
  DiagnosticId,
  DiagnosticStatus,
  graderRepeatability,
  headroom,
  type ItemRecord,
  noiseFloor,
  plumbing,
  REPEATABILITY_MIN_SAMPLE,
  type RepeatabilityObservation,
  renderDiagnostics,
  runDiagnostics,
  runRepeatabilitySample,
  sampleForRepeatability,
  scalingSanity,
} from "../../scripts/evals/grade/diagnostics.ts";
import { NO_EVIDENCE } from "../../scripts/evals/grade/pipeline.ts";
import type { RowLane, RunRow } from "../../scripts/evals/ledger/types.ts";
import { ENDPOINTS } from "../../scripts/evals/report/endpoints.ts";
import { minimumDetectableDifference } from "../../scripts/evals/report/stats.ts";
import { Axis, Effort, GraderFamily, HarnessFailure, ItemVerdict } from "../../scripts/evals/vocabulary.ts";
import { EngineId } from "../../src/shared/providers.ts";
import { CASE_ID, collectedRow, gradingCase, LANES } from "../fixtures/evals/grading/campaign.ts";

/** A graded row of one lane and rep with a checklist score. */
function scored(lane: RowLane, rep: number, score: number, patch: Partial<RunRow> = {}, caseId = CASE_ID): RunRow {
  const base = collectedRow({ lane, rep });
  return {
    ...base,
    runId: `20261001T120000-${lane.id}-${caseId}-r${rep}`,
    case: { ...base.case, id: caseId },
    checklist: {
      scoreAllRuns: score,
      scoreGraded: score,
      byFamily: {},
      inconclusiveRate: 0,
      judgeSkipped: false,
      graderVoid: null,
    },
    ...patch,
  };
}

function observations(family: GraderFamily, total: number, disagreeing: number): RepeatabilityObservation[] {
  return Array.from({ length: total }, (_, index) => ({
    runId: `run-${index}`,
    itemId: `${CASE_ID}-01`,
    family,
    first: ItemVerdict.Pass,
    again: index < disagreeing ? ItemVerdict.Fail : ItemVerdict.Pass,
  }));
}

function itemRecord(runIndex: number, laneId: string, verdict: ItemVerdict, itemIndex = 1): ItemRecord {
  const item = gradingCase.acceptance[itemIndex - 1];
  assert.ok(item);
  return {
    runId: `20261001T120000-${laneId}-${CASE_ID}-r${runIndex}`,
    caseId: CASE_ID,
    laneId,
    runEngine: EngineId.ClaudeCode,
    item,
    combined: verdict,
    verdicts: { [GraderFamily.Claude]: verdict, [GraderFamily.Gpt]: verdict },
    evidence: NO_EVIDENCE,
  };
}

describe("grader repeatability", () => {
  it("reports disagreement per family and turns red above 10%", () => {
    const result = graderRepeatability([
      ...observations(GraderFamily.Claude, 20, 1),
      ...observations(GraderFamily.Gpt, 20, 3),
    ]);
    assert.equal(result.id, DiagnosticId.GraderRepeatability);
    assert.equal(result.status, DiagnosticStatus.Block);
    assert.deepEqual(
      result.findings.map((finding) => [finding.subject, finding.flag, finding.value, finding.n]),
      [[GraderFamily.Gpt, DiagnosticFlag.GraderUnrepeatable, 0.15, 20]],
    );
  });

  it("is green at exactly 10% and not run with no sample", () => {
    assert.equal(graderRepeatability(observations(GraderFamily.Claude, 10, 1)).status, DiagnosticStatus.Ok);
    assert.equal(graderRepeatability([]).status, DiagnosticStatus.NotRun);
  });

  it("samples 10% of the graded items, at least five, the same way for the same seed", () => {
    const items = Array.from({ length: 100 }, (_, index) => itemRecord(index + 1, LANES.a.id, ItemVerdict.Pass));
    assert.equal(sampleForRepeatability(items, "seed1").length, 10);
    assert.equal(sampleForRepeatability(items.slice(0, 30), "seed1").length, REPEATABILITY_MIN_SAMPLE);
    assert.equal(sampleForRepeatability(items.slice(0, 3), "seed1").length, 3);
    assert.deepEqual(sampleForRepeatability(items, "seed1"), sampleForRepeatability(items, "seed1"));
    assert.notDeepEqual(
      sampleForRepeatability(items, "seed1").map((item) => item.runId),
      sampleForRepeatability(items, "seed2").map((item) => item.runId),
    );
  });

  it("re-grades the sample through the injected grader and compares per family", async () => {
    const sample = [itemRecord(1, LANES.a.id, ItemVerdict.Pass), itemRecord(2, LANES.b.id, ItemVerdict.Fail)];
    const seen: string[] = [];
    const result = await runRepeatabilitySample(sample, async (target) => {
      seen.push(target.runId);
      return { [GraderFamily.Claude]: ItemVerdict.Pass, [GraderFamily.Gpt]: ItemVerdict.Fail };
    });
    assert.deepEqual(
      seen,
      sample.map((item) => item.runId),
    );
    const disagreeing = result.filter((entry) => entry.first !== entry.again);
    assert.deepEqual(
      disagreeing.map((entry) => [entry.runId, entry.family]),
      [
        [sample[0]?.runId, GraderFamily.Gpt],
        [sample[1]?.runId, GraderFamily.Claude],
      ],
    );
  });
});

describe("plumbing", () => {
  const cell = (noisy: RunRow[], clean: number) => [
    ...noisy,
    ...Array.from({ length: clean }, (_, index) => scored(LANES.a, 100 + index, 0.5)),
  ];
  const outcome = scored(LANES.a, 1, 0.5).outcome;
  const noisyRows: Array<[string, Partial<RunRow>]> = [
    ["a harness failure", { outcome: { ...outcome, harnessFailure: HarnessFailure.RateLimited } }],
    ["a truncated trace", { outcome: { ...outcome, traceComplete: { parseFailures: 0, truncatedTail: true } } }],
    ["a parse failure", { outcome: { ...outcome, traceComplete: { parseFailures: 2, truncatedTail: false } } }],
    ["an API error", { outcome: { ...outcome, providerNoise: { apiErrors: 1, retries: 0, apiErrorStatus: 529 } } }],
  ];
  for (const [name, patch] of noisyRows) {
    it(`counts ${name} as plumbing noise: red above 5% of a cell`, () => {
      const one = cell([scored(LANES.a, 1, 0.5, patch)], 19);
      assert.equal(plumbing(one).status, DiagnosticStatus.Ok, "1 of 20 is 5%, not above it");
      const two = cell([scored(LANES.a, 1, 0.5, patch), scored(LANES.a, 2, 0.5, patch)], 18);
      const red = plumbing(two);
      assert.equal(red.status, DiagnosticStatus.Block);
      assert.deepEqual(
        red.findings.map((finding) => [finding.flag, finding.value, finding.n]),
        [[DiagnosticFlag.PlumbingNoise, 0.1, 20]],
      );
    });
  }

  it("does not count provider retries that recovered", () => {
    const retried = scored(LANES.a, 1, 0.5, {
      outcome: { ...outcome, providerNoise: { apiErrors: 0, retries: 3, apiErrorStatus: null } },
    });
    assert.equal(plumbing(cell([retried], 1)).status, DiagnosticStatus.Ok);
  });
});

describe("headroom", () => {
  it("flags a case whose primary is at or above 95% for every lane as saturated", () => {
    const rows = [
      scored(LANES.a, 1, 0.96),
      scored(LANES.b, 1, 1),
      scored(LANES.a, 1, 0.96, {}, "open-case"),
      scored(LANES.b, 1, 0.5, {}, "open-case"),
    ];
    const result = headroom(rows);
    assert.equal(result.status, DiagnosticStatus.Warn);
    assert.deepEqual(
      result.findings.map((finding) => [finding.subject, finding.flag, finding.value]),
      [[CASE_ID, DiagnosticFlag.Saturated, 0.96]],
    );
  });

  it("is not run without a measured primary, and leaves harness failures out", () => {
    assert.equal(headroom([collectedRow({ lane: LANES.a })]).status, DiagnosticStatus.NotRun);
    const failed = scored(LANES.b, 2, 0, {
      outcome: { ...scored(LANES.b, 2, 0).outcome, harnessFailure: HarnessFailure.EmptyStream },
    });
    assert.equal(headroom([scored(LANES.a, 1, 1), scored(LANES.b, 1, 1), failed]).status, DiagnosticStatus.Warn);
  });
});

describe("always-failing items", () => {
  it("flags an item failing in every run of every lane over at least six runs, never the control", () => {
    const six = [1, 2, 3].flatMap((rep) => [
      itemRecord(rep, LANES.a.id, ItemVerdict.Fail),
      itemRecord(rep, LANES.b.id, ItemVerdict.Fail),
      itemRecord(rep, LANES.a.id, ItemVerdict.Fail, 4),
      itemRecord(rep, LANES.b.id, ItemVerdict.Fail, 4),
    ]);
    const result = alwaysFailingItems(six);
    assert.equal(result.status, DiagnosticStatus.Warn);
    assert.deepEqual(
      result.findings.map((finding) => [finding.subject, finding.flag, finding.n]),
      [[`${CASE_ID}-01`, DiagnosticFlag.SuspectItem, 6]],
    );
  });

  it("does not flag five runs, one pass, or an inconclusive run", () => {
    const failing = (count: number) =>
      Array.from({ length: count }, (_, index) => itemRecord(index + 1, LANES.a.id, ItemVerdict.Fail));
    assert.equal(alwaysFailingItems(failing(5)).status, DiagnosticStatus.Ok);
    assert.equal(
      alwaysFailingItems([...failing(6), itemRecord(7, LANES.b.id, ItemVerdict.Pass)]).status,
      DiagnosticStatus.Ok,
    );
    assert.equal(
      alwaysFailingItems([...failing(6), itemRecord(7, LANES.b.id, ItemVerdict.Inconclusive)]).status,
      DiagnosticStatus.Ok,
    );
  });
});

describe("noise floor against the smallest actionable change", () => {
  const cellsOf = (cases: number, values: [number, number]) =>
    Array.from({ length: cases }, (_, c) =>
      values.map((value, rep) => scored(LANES.a, rep + 1, value, {}, `case-${c}`)),
    ).flat();

  it("asks for more reps or cases when the MDE is at or above the threshold", () => {
    const rows = cellsOf(2, [0.5, 0.7]);
    const result = noiseFloor(rows, Axis.ProductDefault);
    const sd = Math.sqrt(0.02);
    assert.equal(result.status, DiagnosticStatus.Warn);
    const [finding] = result.findings;
    assert.equal(finding?.flag, DiagnosticFlag.MoreDataNeeded);
    assert.ok(Math.abs((finding?.value ?? 0) - (minimumDetectableDifference(sd, 2) ?? 0)) < 1e-9);
    assert.equal(finding?.threshold, ENDPOINTS[Axis.ProductDefault].minActionableDelta);
    assert.equal(finding?.n, 2);
    assert.match(
      renderDiagnostics(runDiagnostics({ rows, items: [], repeatability: null })),
      /more reps or cases needed/,
    );
  });

  it("is green when the noise is below the threshold, and not run with no repeated cell", () => {
    assert.equal(noiseFloor(cellsOf(10, [0.8, 0.81]), Axis.ProductDefault).status, DiagnosticStatus.Ok);
    assert.equal(noiseFloor([scored(LANES.a, 1, 0.8)], Axis.ProductDefault).status, DiagnosticStatus.NotRun);
  });
});

describe("scaling sanity", () => {
  const low = (row: RunRow): RunRow => ({ ...row, model: { ...row.model, effort: Effort.Low } });

  it("flags a case whose primary rises when effort drops", () => {
    const rows = [
      scored(LANES.a, 1, 0.5),
      scored(LANES.a, 2, 0.5),
      low(scored(LANES.a, 3, 0.8)),
      low(scored(LANES.a, 4, 0.8)),
    ];
    const result = scalingSanity(rows);
    assert.equal(result.status, DiagnosticStatus.Warn);
    assert.deepEqual(
      result.findings.map((finding) => [finding.subject, finding.flag]),
      [[`${CASE_ID} × ${LANES.a.id}`, DiagnosticFlag.ScalingInverted]],
    );
  });

  it("is green when the low-effort twin does not rise, and not run without a twin", () => {
    const rows = [scored(LANES.a, 1, 0.5), low(scored(LANES.a, 2, 0.45))];
    assert.equal(scalingSanity(rows).status, DiagnosticStatus.Ok);
    assert.equal(scalingSanity([scored(LANES.a, 1, 0.5)]).status, DiagnosticStatus.NotRun);
  });
});

describe("the Diagnostics block", () => {
  it("lists every diagnostic, names the red ones as blocking and prints them", () => {
    const outcome = scored(LANES.a, 1, 0.5).outcome;
    const rows = [
      scored(LANES.a, 1, 0.5, { outcome: { ...outcome, harnessFailure: HarnessFailure.AuthExpired } }),
      scored(LANES.a, 2, 0.5),
    ];
    const block = runDiagnostics({
      rows,
      items: [],
      repeatability: observations(GraderFamily.Claude, 10, 5),
    });
    assert.deepEqual(
      [...new Set(block.diagnostics.map((diagnostic) => diagnostic.id))],
      [
        DiagnosticId.GraderRepeatability,
        DiagnosticId.Plumbing,
        DiagnosticId.Headroom,
        DiagnosticId.AlwaysFailingItems,
        DiagnosticId.NoiseFloor,
        DiagnosticId.ScalingSanity,
      ],
    );
    assert.deepEqual(block.blocking, [DiagnosticId.GraderRepeatability, DiagnosticId.Plumbing]);
    const text = renderDiagnostics(block);
    assert.match(text, /^Diagnostics/);
    assert.match(text, new RegExp(`${DiagnosticId.Plumbing}: ${DiagnosticStatus.Block}`));
  });

  it("marks repeatability as not run when no sample was re-graded", () => {
    const block = runDiagnostics({ rows: [scored(LANES.a, 1, 0.5)], items: [], repeatability: null });
    const repeatability = block.diagnostics.find((diagnostic) => diagnostic.id === DiagnosticId.GraderRepeatability);
    assert.equal(repeatability?.status, DiagnosticStatus.NotRun);
    assert.deepEqual(block.blocking, []);
    assert.deepEqual(block.notRun.includes(DiagnosticId.GraderRepeatability), true);
  });
});
