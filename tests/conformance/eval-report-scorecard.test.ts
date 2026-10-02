/**
 * What a report prints: the pre-registered endpoints and how each metric reads a row (a missing
 * measurement is null, never zero), the per-run headline, the Markdown scorecard with its Wilson
 * rates, Kaplan–Meier medians beside their censored counts, per-family checklist and pairwise
 * cells, exposure header and distinct-case footer, and trends over app builds. Hermetic.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  axisLabels,
  bootOutcome,
  countsInN,
  ENDPOINTS,
  ENDPOINTS_SHA,
  formatMetricValue,
  METRICS,
  MetricId,
  renderDescriptive,
  survivalObservation,
} from "../../scripts/evals/report/endpoints.ts";
import { MetricScale } from "../../scripts/evals/report/compare.ts";
import { renderHeadline } from "../../scripts/evals/report/headline.ts";
import { buildScorecard, pairOutcomes, renderScorecardMarkdown } from "../../scripts/evals/report/scorecard.ts";
import { renderTrend, trendSeries } from "../../scripts/evals/report/trend.ts";
import { PAIRWISE_ROW_SCHEMA, type PairwiseRow, type RunRow, unavailable } from "../../scripts/evals/ledger/types.ts";
import {
  Axis,
  CaseExposure,
  CheckResult,
  Coverage,
  EndedHow,
  GraderFamily,
  HarnessFailure,
  NoBuild,
  PairOrder,
  PairOutcome,
  PairPick,
  ResultLabel,
  RowKind,
  UnavailableReason,
} from "../../scripts/evals/vocabulary.ts";

const fixture = path.resolve(import.meta.dirname, "../fixtures/evals/report/run-row.json");
const baseRow = JSON.parse(fs.readFileSync(fixture, "utf8")) as RunRow;
const MIN = 60_000;
const NO_CONTEXT = { sameCampaign: false, neutralGrader: false };

function run(laneId: string, rep: number, edit: (row: RunRow) => void = () => {}): RunRow {
  const row = structuredClone(baseRow);
  row.runId = `20261001T120000-${laneId}-case-one-r${rep}`;
  row.recordedAt = `2026-10-01T12:0${rep}:00Z`;
  row.lane.id = laneId;
  edit(row);
  return row;
}

const noBuild = (row: RunRow) => {
  row.outcome.noBuild = NoBuild.TemplateUntouched;
  row.probe = null;
  row.time.firstBootMs = null;
  row.time.firstPlayableMs = null;
  if (row.checklist) row.checklist.scoreAllRuns = 0;
};

const l1 = (result: CheckResult) => (row: RunRow) => {
  if (row.probe) row.probe.l1Gate = result;
};

const deadline = (row: RunRow) => {
  row.outcome.endedHow = EndedHow.Deadline;
  row.time.wallMs = 90 * MIN;
  row.time.toDoneMs = null;
  row.time.firstPlayableMs = null;
};

describe("endpoints", () => {
  it("registers the §7.1 primaries and hashes the registration", () => {
    assert.equal(ENDPOINTS[Axis.ProductDefault].primary, MetricId.ScoreAllRuns);
    assert.equal(ENDPOINTS[Axis.ModelStack].primary, MetricId.ScoreAllRuns);
    assert.equal(ENDPOINTS[Axis.Version].primary, MetricId.BootRate);
    assert.deepEqual(ENDPOINTS[Axis.ProductDefault].secondaries, [
      MetricId.PlayableWithin30Min,
      MetricId.PairwiseOverallWin,
    ]);
    assert.match(ENDPOINTS_SHA, /^[0-9a-f]{12}$/);
  });

  it("compares time, token and call metrics on a log scale and scores and rates linearly", () => {
    for (const id of [MetricId.WallMs, MetricId.Output, MetricId.ModelCalls])
      assert.equal(METRICS[id].scale, MetricScale.Log);
    for (const id of [MetricId.ScoreAllRuns, MetricId.BootRate, MetricId.ApiEquivalentUsd]) {
      assert.equal(METRICS[id].scale, MetricScale.Linear);
    }
  });

  it("reads a missing measurement as null and a no-build run as a failed boot", () => {
    assert.equal(bootOutcome(run("l", 1)), 1);
    assert.equal(bootOutcome(run("l", 1, noBuild)), 0);
    assert.equal(bootOutcome(run("l", 1, (r) => (r.probe = null))), null);
    assert.equal(bootOutcome(run("l", 1, l1(CheckResult.Unknown))), null);
    const partial = run("l", 1, (r) => (r.tokens.coverage = Coverage.PartialJudges));
    assert.equal(METRICS[MetricId.Output].read?.(partial), null);
    const priceless = run("l", 1, (r) => (r.cost.apiEquivalentUsd = unavailable(UnavailableReason.PriceUnknown)));
    assert.equal(METRICS[MetricId.ApiEquivalentUsd].read?.(priceless), null);
    const dirty = run("l", 1, (r) => (r.time.coverage = Coverage.TraceDirty));
    assert.equal(METRICS[MetricId.WallMs].read?.(dirty), null);
    const voided = run("l", 1, (r) => {
      if (r.checklist) r.checklist.graderVoid = "control-passed";
    });
    assert.equal(METRICS[MetricId.ScoreAllRuns].read?.(voided), null);
  });

  it("counts only build rows without a harness failure or a void in n", () => {
    assert.equal(countsInN(run("l", 1)), true);
    assert.equal(countsInN(run("l", 1, (r) => (r.outcome.harnessFailure = HarnessFailure.CliMissing))), false);
    assert.equal(countsInN(run("l", 1, (r) => (r.kind = RowKind.Canary))), false);
    assert.equal(countsInN(run("l", 1, (r) => (r.campaignVoid = "cli-changed"))), false);
  });

  it("censors time to done at the wall time unless the agent finished", () => {
    assert.deepEqual(survivalObservation(run("l", 1), MetricId.ToDoneMs), { time: 30 * MIN, event: true });
    assert.deepEqual(survivalObservation(run("l", 1, deadline), MetricId.ToDoneMs), { time: 90 * MIN, event: false });
    assert.deepEqual(survivalObservation(run("l", 1, deadline), MetricId.FirstPlayableMs), {
      time: 90 * MIN,
      event: false,
    });
    const unprobed = run("l", 1, (r) => {
      r.probe = null;
      r.time.firstPlayableMs = null;
    });
    assert.equal(survivalObservation(unprobed, MetricId.FirstPlayableMs), null);
    const staleNoBuild = run("l", 1, (r) => (r.outcome.noBuild = NoBuild.NoEntry));
    assert.deepEqual(survivalObservation(staleNoBuild, MetricId.FirstBootMs), { time: 30 * MIN, event: false });
    assert.deepEqual(survivalObservation(staleNoBuild, MetricId.FirstPlayableMs), { time: 30 * MIN, event: false });
  });

  it("labels the model axis grader-confounded and cross-campaign versions longitudinal", () => {
    assert.deepEqual(axisLabels(Axis.ModelStack, NO_CONTEXT), [ResultLabel.GraderFamilyConfounded]);
    assert.deepEqual(axisLabels(Axis.ModelStack, { sameCampaign: true, neutralGrader: true }), []);
    assert.deepEqual(axisLabels(Axis.Version, NO_CONTEXT), [ResultLabel.Longitudinal]);
    assert.deepEqual(axisLabels(Axis.Version, { sameCampaign: true, neutralGrader: false }), []);
  });

  it("prints descriptive metrics without direction words and with the chance note", () => {
    const text = renderDescriptive(
      [
        { metric: MetricId.WallMs, a: [10 * MIN, 11 * MIN, 12 * MIN], b: [30 * MIN, 31 * MIN, 32 * MIN] },
        { metric: MetricId.Output, a: [1, 2, 3], b: [2, 3, 4] },
      ],
      "A",
      "B",
    );
    assert.match(text, /^Descriptive \(no inference\)/);
    assert.match(
      text,
      /time\.wallMs: A median 11 min \(n=3\) · B median 31 min \(n=3\) · Mann–Whitney p=0\.10 \(descriptive\)/,
    );
    assert.match(text, /0 of 2 descriptive metrics moved; about 0\.1 would by chance/);
    assert.doesNotMatch(text, /better|worse|improv|regress|favou?r|faster|slower|higher|lower/i);
  });

  it("formats a missing value as words and a measured zero as a number", () => {
    assert.equal(formatMetricValue(MetricId.WallMs, null), "not measured");
    assert.equal(formatMetricValue(MetricId.Compactions, 0), "0");
    assert.equal(formatMetricValue(MetricId.ApiEquivalentUsd, 3.5), "$3.50 est.");
    assert.equal(formatMetricValue(MetricId.BootRate, 0.5), "50%");
  });
});

describe("headline", () => {
  it("prints one line per run with marks, score, estimate and time", () => {
    assert.equal(
      renderHeadline(run("genex-claude", 1)),
      "case-one · genex-claude · claude-opus-5-5 · agent finished · L1 ✓ · L2 ✓ · checklist 75% · $3.50 est. · 30 min",
    );
  });

  it("prints a no-build run's typed reason and no L1 mark", () => {
    const line = renderHeadline(run("l", 1, noBuild));
    assert.match(line, /no build · template-untouched/);
    assert.doesNotMatch(line, /L1/);
  });

  it("does not score L2 after an L1 failure and never dresses unknown as a pass", () => {
    assert.match(renderHeadline(run("l", 1, l1(CheckResult.Fail))), /L1 ✗ · L2 not scored/);
    assert.match(renderHeadline(run("l", 1, l1(CheckResult.Unknown))), /L1 ~/);
  });

  it("keeps rail stops, harness failures and missing values apart", () => {
    assert.match(renderHeadline(run("l", 1, deadline)), /rail stop: deadline/);
    assert.match(renderHeadline(run("l", 1, (r) => (r.outcome.endedHow = EndedHow.Crash))), /ended: crash/);
    const harness = run("l", 1, (r) => (r.outcome.harnessFailure = HarnessFailure.EmptyStream));
    assert.match(renderHeadline(harness), /harness failure: empty-stream \(excluded from n\) · not yet replaced/);
    const blank = run("l", 1, (r) => {
      r.cost.apiEquivalentUsd = unavailable(UnavailableReason.PriceUnknown);
      r.time.wallMs = null;
      r.model.main = null;
    });
    assert.match(
      renderHeadline(blank),
      /main model not reported .* cost unavailable \(price-unknown\) · time not measured$/,
    );
  });
});

function pair(rep: number, family: GraderFamily, order: PairOrder, pick: PairPick, forfeit = false): PairwiseRow {
  const facets = { overall: pick, works: pick, visuals: pick, feel: pick, play: pick };
  return {
    schema: PAIRWISE_ROW_SCHEMA,
    campaignId: baseRow.campaignId,
    recordedAt: "2026-10-01T13:00:00Z",
    gradeSeq: 1,
    gradeId: "a1b2c3d4e5f6",
    caseId: "case-one",
    caseVersion: baseRow.case.version,
    rep,
    axis: Axis.ProductDefault,
    lanes: { first: "genex-claude", second: "raw-claude" },
    runIds: {
      first: `20261001T120000-genex-claude-case-one-r${rep}`,
      second: `20261001T120000-raw-claude-case-one-r${rep}`,
    },
    order,
    blindSeed: "seed",
    family,
    graderModel: "claude-sonnet-5-5",
    sameFamily: family === GraderFamily.Claude,
    pairwiseRubricSha: "cdcdcdcdcdcd",
    picks: facets,
    judgeSkipped: false,
    ...(forfeit ? { forfeit: true } : {}),
  };
}

const pairs: PairwiseRow[] = [
  pair(1, GraderFamily.Claude, PairOrder.FirstLeft, PairPick.Left),
  pair(1, GraderFamily.Claude, PairOrder.FirstRight, PairPick.Right),
  pair(2, GraderFamily.Claude, PairOrder.FirstLeft, PairPick.Left),
  pair(2, GraderFamily.Claude, PairOrder.FirstRight, PairPick.Left),
  pair(3, GraderFamily.Claude, PairOrder.FirstLeft, PairPick.Left),
  pair(1, GraderFamily.Gpt, PairOrder.FirstLeft, PairPick.Right),
  pair(1, GraderFamily.Gpt, PairOrder.FirstRight, PairPick.Left),
];

describe("pairwise outcomes", () => {
  /** One pair (rep 1, Claude family) judged under another rubric as a later pass. */
  const repass = (gradeSeq: number, order: PairOrder, pick: PairPick): PairwiseRow => ({
    ...pair(1, GraderFamily.Claude, order, pick),
    gradeSeq,
    pairwiseRubricSha: gradeSeq === 1 ? "000000000001" : "000000000002",
  });

  it("reads only the latest judging pass of a pair, never a mix of two passes", () => {
    const firstWins = [repass(1, PairOrder.FirstLeft, PairPick.Left), repass(1, PairOrder.FirstRight, PairPick.Right)];
    const secondWins = [repass(2, PairOrder.FirstLeft, PairPick.Right), repass(2, PairOrder.FirstRight, PairPick.Left)];
    assert.deepEqual(
      pairOutcomes([...firstWins, ...secondWins]).map((p) => p.outcome),
      [PairOutcome.Second],
    );
    assert.deepEqual(
      pairOutcomes([...firstWins, repass(2, PairOrder.FirstLeft, PairPick.Right)]).map((p) => p.outcome),
      [PairOutcome.Invalid],
      "the latest pass is missing an order",
    );
  });

  it("never merges two different run pairs of the same rep", () => {
    const other = (order: PairOrder, pick: PairPick): PairwiseRow => ({
      ...pair(1, GraderFamily.Claude, order, pick),
      runIds: { first: "20261001T130000-genex-claude-case-one-r1", second: "20261001T130000-raw-claude-case-one-r1" },
    });
    const outcomes = pairOutcomes([
      pair(1, GraderFamily.Claude, PairOrder.FirstLeft, PairPick.Left),
      pair(1, GraderFamily.Claude, PairOrder.FirstRight, PairPick.Right),
      other(PairOrder.FirstLeft, PairPick.Right),
      other(PairOrder.FirstRight, PairPick.Left),
    ]).map((p) => p.outcome);
    assert.deepEqual(outcomes, [PairOutcome.First, PairOutcome.Second]);
  });

  it("wins only when both orders agree; a disagreement or a missing order is not a win", () => {
    const outcomes = pairOutcomes(pairs).map((p) => [p.family, p.rep, p.outcome]);
    assert.deepEqual(outcomes, [
      [GraderFamily.Claude, 1, PairOutcome.First],
      [GraderFamily.Claude, 2, PairOutcome.PositionInconsistent],
      [GraderFamily.Claude, 3, PairOutcome.Invalid],
      [GraderFamily.Gpt, 1, PairOutcome.Second],
    ]);
  });
});

describe("pairwise forfeits", () => {
  // Rep 4: raw-claude shipped no build, so genex-claude takes the pair by forfeit in both orders.
  const forfeits = [
    pair(4, GraderFamily.Claude, PairOrder.FirstLeft, PairPick.Left, true),
    pair(4, GraderFamily.Claude, PairOrder.FirstRight, PairPick.Right, true),
  ];

  it("counts a forfeit as a win for the side that built and a loss for the no-build, apart from judged pairs", () => {
    const [result] = pairOutcomes(forfeits);
    assert.equal(result?.outcome, PairOutcome.First);
    assert.equal(result?.forfeit, true);
    const card = buildScorecard({
      campaignId: baseRow.campaignId,
      rows: [run("genex-claude", 4), run("raw-claude", 4, noBuild)],
      pairwise: forfeits,
      laneOrder: ["genex-claude", "raw-claude"],
    });
    const [genex, raw] = card.cases[0].lanes;
    const tally = (lane: typeof genex) =>
      lane.pairwise?.byFamily.find(([family]) => family === GraderFamily.Claude)?.[1];
    assert.deepEqual(
      [tally(genex)?.wins, tally(genex)?.forfeitWins, tally(genex)?.invalid],
      [0, 1, 0],
      "a forfeit is never a judged win, and never invalid",
    );
    assert.deepEqual([tally(raw)?.losses, tally(raw)?.forfeitLosses, tally(raw)?.invalid], [0, 1, 0]);
    const text = renderScorecardMarkdown(card);
    assert.match(
      text,
      /vs raw-claude: claude no decided pairs \(0 tie, 0 position-inconsistent, 0 invalid; 1 won by forfeit\)/,
    );
    assert.match(
      text,
      /vs genex-claude: claude no decided pairs \(0 tie, 0 position-inconsistent, 0 invalid; 1 lost by forfeit\)/,
    );
  });
});

describe("scorecard", () => {
  const rows: RunRow[] = [
    run("genex-claude", 1),
    run("genex-claude", 2),
    run("genex-claude", 3),
    run("raw-claude", 1, (r) => (r.tokens.coverage = Coverage.PartialJudges)),
    run("raw-claude", 2, noBuild),
    run("raw-claude", 3, deadline),
    run("raw-claude", 4, (r) => {
      r.outcome.harnessFailure = HarnessFailure.RateLimited;
      r.supersededBy = "20261001T120000-raw-claude-case-one-r3";
    }),
    run("genex-claude", 5, (r) => (r.kind = RowKind.Canary)),
  ].map((row) => {
    row.case.exposure = CaseExposure.DevTuned;
    return row;
  });
  const card = buildScorecard({
    campaignId: baseRow.campaignId,
    rows,
    pairwise: pairs,
    laneOrder: ["genex-claude", "raw-claude", "raw-codex", "genex-codex"],
  });

  it("orders lanes by the registry and counts n, void, harness and replaced", () => {
    const [genex, raw] = card.cases[0].lanes;
    assert.deepEqual([genex.letter, genex.laneId, genex.n], ["A", "genex-claude", 3]);
    assert.deepEqual([raw.letter, raw.laneId, raw.n, raw.harness, raw.replaced], ["B", "raw-claude", 3, 1, 1]);
    assert.equal(card.distinctCases, 1);
  });

  it("rates boot and playable with Wilson, and keeps censored counts beside Kaplan–Meier medians", () => {
    const text = renderScorecardMarkdown(card);
    assert.match(text, /\| A genex-claude \| 3 \| 0 · 0 · 0 \| 3\/3 \(100%, 95% CI 44–100%\) \|/);
    assert.match(text, /\| B raw-claude \| 3 \| 0 · 1 · 1 \| 2\/3 \(67%, 95% CI 21–94%\) \|/);
    assert.match(text, /10 min \(0 of 3 censored\) \| 30 min \(0 of 3 censored\)/);
    assert.match(text, /not reached \(2 of 3 censored\) \| 30 min \(1 of 3 censored\)/);
  });

  it("prints nulls as words, scores per family and pairwise per family", () => {
    const text = renderScorecardMarkdown(card);
    assert.match(text, /claude 75% · gpt 63% · combined 75%/);
    assert.match(
      text,
      /vs raw-claude: claude 1\/1 won \(100%, 95% CI 21–100%; 0 tie, 1 position-inconsistent, 1 invalid\) · gpt 0\/1 won/,
    );
    assert.match(text, /vs genex-claude: claude 0\/1 won/);
    assert.doesNotMatch(text, /\bNaN\b|undefined|null/);
    const [, raw] = card.cases[0].lanes;
    assert.equal(raw.tokens.output, 50000);
  });

  it("scores each family over all runs as combined does: a judge-skipped or no-build run is 0", () => {
    const skipped = (row: RunRow) => {
      noBuild(row);
      if (!row.checklist) return;
      row.checklist.judgeSkipped = true;
      row.checklist.scoreGraded = null;
      row.checklist.byFamily = {
        [GraderFamily.Claude]: { passed: 0, graded: 0, inconclusive: 0 },
        [GraderFamily.Gpt]: { passed: 0, graded: 0, inconclusive: 0 },
      };
    };
    const graded = (row: RunRow) => {
      if (!row.checklist) return;
      row.checklist.scoreAllRuns = 1;
      row.checklist.byFamily = {
        [GraderFamily.Claude]: { passed: 8, graded: 8, inconclusive: 0 },
        [GraderFamily.Gpt]: { passed: 8, graded: 8, inconclusive: 0 },
      };
    };
    const lane = buildScorecard({
      campaignId: baseRow.campaignId,
      rows: [run("l", 1, skipped), run("l", 2, skipped), run("l", 3, graded)],
      laneOrder: ["l"],
    }).cases[0].lanes[0];
    assert.deepEqual(lane.checklist.byFamily, [
      [GraderFamily.Claude, 1 / 3],
      [GraderFamily.Gpt, 1 / 3],
    ]);
    assert.equal(lane.checklist.combined, 1 / 3);
  });

  it("shows the exposure in the header and the distinct-case footer", () => {
    const text = renderScorecardMarkdown(card);
    assert.match(text, /## case-one · version 0a1b2c3d4e5f · exposure: dev-tuned/);
    assert.match(text, /Direction needs ≥5 distinct cases; this campaign has 1\.\n$/);
  });

  it("prints 'not measured' for a lane with no measurement", () => {
    const blind = rows.slice(0, 3).map((row) => {
      const copy = structuredClone(row);
      copy.context.coverage = Coverage.Unmeasured;
      copy.probe = null;
      copy.time.firstPlayableMs = null;
      return copy;
    });
    const text = renderScorecardMarkdown(
      buildScorecard({ campaignId: baseRow.campaignId, rows: blind, laneOrder: [] }),
    );
    assert.match(text, /\| not measured \| not measured \|/);
    assert.match(text, /no pairwise/);
  });
});

describe("trend", () => {
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const rows = [
    run("genex-claude", 1, (r) => (r.pins.run.appSha = shaA)),
    run("genex-claude", 2, (r) => {
      r.pins.run.appSha = shaA;
      r.time.wallMs = null;
    }),
    run("genex-claude", 3, (r) => {
      r.pins.run.appSha = shaB;
      r.campaignId = "20261002T120000-later";
      r.time.wallMs = 20 * MIN;
    }),
    run("genex-claude", 4, (r) => (r.pins.run.appSha = unavailable(UnavailableReason.NotRecorded))),
    run("raw-claude", 1),
  ];

  it("groups one lane and case by app build in the caller's order, counting missing values", () => {
    const series = trendSeries(rows, MetricId.WallMs, {
      laneId: "genex-claude",
      caseId: "case-one",
      appOrder: [shaB, shaA],
    });
    assert.deepEqual(
      series.points.map((p) => [p.appSha, p.runs, p.values, p.missing, p.median]),
      [
        [shaB, 1, [20 * MIN], 0, 20 * MIN],
        [shaA, 2, [30 * MIN], 1, 30 * MIN],
      ],
    );
    assert.equal(series.unplaced, 1);
    assert.deepEqual(series.labels, [ResultLabel.Longitudinal, ResultLabel.Descriptive]);
  });

  it("renders missing runs as a count, never as a zero point", () => {
    const text = renderTrend(trendSeries(rows, MetricId.WallMs, { laneId: "genex-claude", caseId: "case-one" }));
    assert.match(text, /aaaaaaaa: median 30 min · 1 measured, 1 not measured/);
    assert.match(text, /1 runs have no app build pin/);
    assert.doesNotMatch(text, /\b0 min/);
  });
});
