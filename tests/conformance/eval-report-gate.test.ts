/**
 * `eval check` and `baseline promote` as pure decisions: gate eligibility (Wilson LB ≥ 0.5 over ≥ 6
 * baseline runs), the sequential clear/flaky/probable/regression walk and its exit codes, harness
 * failures left out of n, printed false-alarm and detection odds, drift only at ≥ 8 baseline runs,
 * and every promotion refusal. Hermetic: synthetic rows from one fixture.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  BASELINE_SCHEMA,
  BaselineError,
  baselineJson,
  epochOf,
  PromoteRefusal,
  parseBaseline,
  promoteDecision,
  type PromoteInput,
} from "../../scripts/evals/report/baseline.ts";
import {
  checkCell,
  checkCellRows,
  checkOutcome,
  drift,
  gateEligibility,
  gateStep,
  renderCell,
  renderCheck,
  renderDrift,
} from "../../scripts/evals/report/check.ts";
import { ENDPOINTS_SHA, MetricId } from "../../scripts/evals/report/endpoints.ts";
import { wilson } from "../../scripts/evals/report/stats.ts";
import type { RunRow } from "../../scripts/evals/ledger/types.ts";
import { CaseVisibility, CheckResult, CheckState, HarnessFailure, NoteCode } from "../../scripts/evals/vocabulary.ts";

const fixture = path.resolve(import.meta.dirname, "../fixtures/evals/report/run-row.json");
const baseRow = JSON.parse(fs.readFileSync(fixture, "utf8")) as RunRow;

function run(caseId: string, laneId: string, rep: number, edit: (row: RunRow) => void = () => {}): RunRow {
  const row = structuredClone(baseRow);
  row.runId = `20261001T120000-${laneId}-${caseId}-r${rep}`;
  row.recordedAt = `2026-10-01T12:0${rep}:00Z`;
  row.case.id = caseId;
  row.lane.id = laneId;
  edit(row);
  return row;
}

const noBoot = (row: RunRow) => {
  if (row.probe) row.probe.l1Gate = CheckResult.Fail;
};

describe("gate eligibility", () => {
  it("arms only at ≥ 6 baseline runs with a Wilson lower bound ≥ 0.5", () => {
    const table: [(number | null)[], boolean][] = [
      [[1, 1, 1, 1, 1, 1], true],
      [[1, 1, 1], false],
      [[1, 1, 1, 1, 1, 0], false],
      [[1, 1, 1, 1, 1, 1, 1, 1], true],
      [[1, 1, 1, 1, 1, 1, null], true],
      [[1, 1, 1, 1, 1, null], false],
      [[], false],
    ];
    for (const [boots, eligible] of table)
      assert.equal(gateEligibility(boots).eligible, eligible, JSON.stringify(boots));
  });
});

describe("the sequential gate", () => {
  it("walks attempts to clear, flaky, probable or regression", () => {
    const table: [boolean[], CheckState | null, boolean][] = [
      [[], null, true],
      [[true], CheckState.Clear, false],
      [[false], null, true],
      [[false, true], CheckState.Flaky, false],
      [[false, false], CheckState.Probable, true],
      [[false, false, false], CheckState.Regression, false],
      [[false, false, true], CheckState.Flaky, false],
      [[true, true], CheckState.Clear, false],
      [[true, false], CheckState.Flaky, false],
      [[true, false, false], CheckState.Flaky, false],
      [[true, true, false], CheckState.Flaky, false],
    ];
    for (const [attempts, state, rerun] of table) {
      assert.deepEqual(gateStep(attempts), { state, rerun }, JSON.stringify(attempts));
    }
  });

  it("gives the same verdict to every order of the same planned reps: a failure after a pass is flaky", () => {
    const orders = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    for (const candidateBoots of orders) {
      const cell = checkCell({ caseId: "c", laneId: "l", baselineBoots: [1, 1, 1, 1, 1, 1, 1, 1], candidateBoots });
      assert.equal(cell.state, CheckState.Flaky, JSON.stringify(candidateBoots));
      assert.deepEqual(checkOutcome([cell]), { state: CheckState.Flaky, exitCode: 4 }, JSON.stringify(candidateBoots));
    }
  });

  it("maps the worst cell to exit codes 0, 4, 3 and 2, counting a pending cell as flaky", () => {
    const cell = (candidateBoots: number[]) =>
      checkCell({ caseId: "c", laneId: "l", baselineBoots: [1, 1, 1, 1, 1, 1], candidateBoots });
    assert.deepEqual(checkOutcome([]), { state: CheckState.Clear, exitCode: 0 });
    assert.deepEqual(checkOutcome([cell([1]), cell([0, 1])]), { state: CheckState.Flaky, exitCode: 4 });
    assert.deepEqual(checkOutcome([cell([0, 0]), cell([0, 1])]), { state: CheckState.Probable, exitCode: 3 });
    assert.deepEqual(checkOutcome([cell([0, 0, 0]), cell([0, 0])]), { state: CheckState.Regression, exitCode: 2 });
    assert.deepEqual(checkOutcome([cell([0])]), { state: CheckState.Flaky, exitCode: 4 });
  });

  it("never fires on an unarmed cell, even when every candidate run fails", () => {
    const cell = checkCell({ caseId: "c", laneId: "l", baselineBoots: [1, 1, 1], candidateBoots: [0, 0, 0] });
    assert.equal(cell.armed, false);
    assert.equal(cell.state, CheckState.Clear);
    assert.match(renderCell(cell), /clear — gate not armed \(baseline 3\/3 booted, Wilson LB 44%; needs ≥6 runs/);
  });

  it("prints the false-alarm probability under the baseline LB and the detection probability at half the rate", () => {
    const cell = checkCell({ caseId: "c", laneId: "l", baselineBoots: [1, 1, 1, 1, 1, 1], candidateBoots: [0, 0, 0] });
    assert.equal(cell.state, CheckState.Regression);
    assert.ok(cell.falseAlarm !== null && Math.abs(cell.falseAlarm - (1 - 0.609637) ** 3) < 1e-4);
    assert.equal(cell.detection, 0.125);
    assert.match(
      renderCell(cell),
      /P\(regression \| healthy at baseline LB\) 6%; P\(regression \| boot rate halved\) 13%/,
    );
  });

  it("prints the odds of the count rule over every measured attempt, not of one attempt", () => {
    const lowerBound = wilson(20, 20).lo;
    const flaky = checkCell({
      caseId: "c",
      laneId: "l",
      baselineBoots: Array(20).fill(1),
      candidateBoots: [1, 1, 1, 1, 0],
    });
    assert.equal(flaky.state, CheckState.Flaky);
    assert.ok(flaky.falseAlarm !== null && Math.abs(flaky.falseAlarm - (1 - lowerBound ** 5)) < 1e-9);
    assert.ok(flaky.detection !== null && Math.abs(flaky.detection - (1 - 0.5 ** 5)) < 1e-9);
    const regression = checkCell({
      caseId: "c",
      laneId: "l",
      baselineBoots: [1, 1, 1, 1, 1, 1],
      candidateBoots: [0, 0, 0, 0, 0, 0],
    });
    assert.equal(regression.state, CheckState.Regression);
    assert.ok(regression.falseAlarm !== null && Math.abs(regression.falseAlarm - (1 - wilson(6, 6).lo) ** 6) < 1e-9);
    assert.equal(regression.detection, 0.5 ** 6);
  });

  it("leaves harness failures, void rows and unprobed runs out of the attempts", () => {
    const baseline = Array.from({ length: 6 }, (_, rep) => run("c", "genex-claude", rep));
    const candidate = [
      run("c", "genex-claude", 1, (row) => {
        row.outcome.harnessFailure = HarnessFailure.RateLimited;
        noBoot(row);
      }),
      run("c", "genex-claude", 2, (row) => (row.probe = null)),
      run("c", "genex-claude", 3),
    ];
    const cell = checkCellRows("c", "genex-claude", baseline, candidate);
    assert.deepEqual(cell.attempts, [true]);
    assert.equal(cell.state, CheckState.Clear);
    assert.equal(cell.excluded, 2);
  });
});

describe("drift", () => {
  it("refuses below eight baseline runs and shows the values side by side", () => {
    const [result] = drift([{ metric: MetricId.BootRate, baseline: [1, 1, 1, 1, 1, 1, 1], candidate: [1, 0] }]);
    assert.equal(result.tooSmall, true);
    assert.match(
      renderDrift([result]),
      /rate\.boot: baseline too small for drift \(n=7\) · baseline: 100%, .* · candidate: 100%, 0%/,
    );
  });

  it("tests each primary at eight runs and Holm-adjusts across them", () => {
    const results = drift([
      { metric: MetricId.ScoreAllRuns, baseline: [1, 2, 3, 4, 5, 6, 7, 8], candidate: [9, 10, 11] },
      { metric: MetricId.BootRate, baseline: [1, 2, 3, 4, 5, 6, 7, 8], candidate: [1, 2, 3] },
    ]);
    const [first, second] = results;
    assert.ok(!first.tooSmall && !second.tooSmall);
    if (first.tooSmall || second.tooSmall) throw new Error("unreachable");
    assert.ok(first.p < second.p);
    assert.equal(first.adjusted, Math.min(1, first.p * 2));
    assert.match(renderCheck([], results), /Mann–Whitney p=.*, Holm .* \(descriptive drift\)/);
  });
});

const cellRows = (caseId: string, laneId: string, reps = 3) =>
  Array.from({ length: reps }, (_, rep) => run(caseId, laneId, rep + 1));
type Input = Omit<PromoteInput, "rows"> & { rows: RunRow[] };
const good = (): Input => ({
  campaignId: baseRow.campaignId,
  rows: [
    ...cellRows("case-one", "genex-claude"),
    ...cellRows("case-one", "raw-claude"),
    ...cellRows("case-two", "genex-claude"),
  ],
  openingCanary: CheckResult.Pass,
  closingCanary: CheckResult.Pass,
  calibrationGreen: true,
  promotedAt: "2026-10-02T09:00:00Z",
});

describe("baseline promotion", () => {
  it("writes raw values per metric per lane, one file per case, that parse back", () => {
    const decision = promoteDecision(good());
    assert.ok(decision.ok);
    if (!decision.ok) throw new Error("unreachable");
    assert.deepEqual(
      decision.baselines.map((file) => [file.caseId, file.lanes.map((lane) => lane.laneId)]),
      [
        ["case-one", ["genex-claude", "raw-claude"]],
        ["case-two", ["genex-claude"]],
      ],
    );
    const [first] = decision.baselines;
    assert.equal(first.schema, BASELINE_SCHEMA);
    assert.equal(first.endpointsSha, ENDPOINTS_SHA);
    assert.match(first.epoch, /^[0-9a-f]{12}$/);
    const lane = first.lanes[0];
    assert.equal(lane.runIds.length, 3);
    assert.deepEqual(lane.metrics[MetricId.WallMs], [1800000, 1800000, 1800000]);
    assert.deepEqual(lane.metrics[MetricId.FirstPreviewMs], [240000, 240000, 240000]);
    assert.equal(lane.pins["run.cliVersion"], "2.1.300");
    assert.deepEqual(parseBaseline(baselineJson(first)), first);
  });

  it("never promotes a holdout case, while its cells still gate the promotion", () => {
    const holdout = (laneId: string, reps = 3) =>
      Array.from({ length: reps }, (_, rep) =>
        run("holdout-1", laneId, rep + 1, (row) => (row.case.visibility = CaseVisibility.Holdout)),
      );
    const input = good();
    input.rows.push(...holdout("genex-claude"));
    const decision = promoteDecision(input);
    assert.ok(decision.ok);
    if (!decision.ok) throw new Error("unreachable");
    assert.deepEqual(
      decision.baselines.map((file) => file.caseId),
      ["case-one", "case-two"],
    );
    assert.equal(decision.withheldHoldouts, 1);
    assert.equal(JSON.stringify(decision.baselines).includes("holdout-1"), false, "no holdout id or run id");

    const short = good();
    short.rows.push(...holdout("genex-claude", 2));
    const refused = promoteDecision(short);
    assert.equal(refused.ok, false, "a holdout cell with too few runs still refuses");

    const onlyHoldouts = { ...good(), rows: holdout("genex-claude") };
    const none = promoteDecision(onlyHoldouts);
    assert.equal(none.ok, false);
    if (none.ok) return;
    assert.deepEqual(
      none.refusals.map((refusal) => refusal.code),
      [PromoteRefusal.NoPublicCases],
    );
  });

  it("keeps a missing measurement as null, never zero", () => {
    const input = good();
    input.rows[0].cost.apiEquivalentUsd = { unavailable: true, reason: "price-unknown" };
    const decision = promoteDecision(input);
    if (!decision.ok) throw new Error("unreachable");
    assert.equal(decision.baselines[0].lanes[0].metrics[MetricId.ApiEquivalentUsd][0], null);
  });
});

describe("baseline refusals", () => {
  it("refuses on each condition, naming it", () => {
    const table: [string, (input: Input) => void, PromoteRefusal][] = [
      ["opening canary", (i) => (i.openingCanary = CheckResult.Fail), PromoteRefusal.OpeningCanary],
      ["closing canary unknown", (i) => (i.closingCanary = CheckResult.Unknown), PromoteRefusal.ClosingCanary],
      ["calibration", (i) => (i.calibrationGreen = false), PromoteRefusal.CalibrationRed],
      [
        "void",
        (i) => i.rows.push(run("case-one", "genex-claude", 4, (r) => (r.campaignVoid = "closing-canary"))),
        PromoteRefusal.CampaignVoid,
      ],
      [
        "unreplaced harness failure",
        (i) =>
          i.rows.push(
            run("case-one", "genex-claude", 5, (r) => (r.outcome.harnessFailure = HarnessFailure.AuthExpired)),
          ),
        PromoteRefusal.UnreplacedHarnessFailure,
      ],
      ["too few runs", (i) => i.rows.splice(0, 1), PromoteRefusal.TooFewRuns],
      ["quick grade", (i) => i.rows[0].notes.push(NoteCode.QuickGrade), PromoteRefusal.QuickGrade],
      [
        "quick probe",
        (i) => {
          if (i.rows[0].probe) i.rows[0].probe.quick = true;
        },
        PromoteRefusal.QuickGrade,
      ],
      ["pins differ in a cell", (i) => (i.rows[0].pins.run.cliVersion = "2.1.301"), PromoteRefusal.Incomparable],
      ["another campaign", (i) => (i.rows[0].campaignId = "20261002T000000-other"), PromoteRefusal.MixedCampaign],
      ["no runs", (i) => (i.rows = []), PromoteRefusal.NoRuns],
    ];
    for (const [name, edit, code] of table) {
      const input = good();
      edit(input);
      const decision = promoteDecision(input);
      assert.equal(decision.ok, false, name);
      if (decision.ok) continue;
      assert.ok(
        decision.refusals.some((refusal) => refusal.code === code),
        `${name}: ${JSON.stringify(decision.refusals)}`,
      );
    }
  });

  it("accepts a harness failure that a replacement rep superseded", () => {
    const input = good();
    const failed = run("case-one", "genex-claude", 9, (r) => {
      r.outcome.harnessFailure = HarnessFailure.EmptyStream;
      r.supersededBy = input.rows[0].runId;
    });
    input.rows.push(failed);
    const decision = promoteDecision(input);
    assert.ok(decision.ok);
    if (!decision.ok) throw new Error("unreachable");
    assert.ok(!decision.baselines[0].lanes[0].runIds.includes(failed.runId));
  });

  it("opens a new epoch when a lane's CLI version or served model changes", () => {
    const rows = good().rows;
    const moved = rows.map((row) => structuredClone(row));
    for (const row of moved) row.pins.run.cliVersion = "2.2.0";
    assert.notEqual(epochOf(rows), epochOf(moved));
    assert.equal(epochOf(rows), epochOf([...rows].reverse()));
  });
});

describe("baseline files", () => {
  it("refuses a hostile or malformed baseline file by field", () => {
    const decision = promoteDecision(good());
    if (!decision.ok) throw new Error("unreachable");
    const valid = JSON.parse(baselineJson(decision.baselines[0]));
    const table: [string, (file: Record<string, unknown> & { lanes: Record<string, unknown>[] }) => void][] = [
      ["schema", (f) => (f.schema = "genex-evals/baseline/0")],
      ["caseId", (f) => (f.caseId = "../escape")],
      ["caseVersion", (f) => (f.caseVersion = "/Users/someone")],
      ["epoch", (f) => (f.epoch = "not-a-digest")],
      ["lanes[0].laneId", (f) => (f.lanes[0].laneId = "<script>")],
      ["lanes[0].endedHow", (f) => (f.lanes[0].endedHow = ["agent-finished"])],
      ["lanes[0].metrics", (f) => ((f.lanes[0].metrics as Record<string, unknown>)["time.secret"] = [1, 2, 3])],
      [
        `lanes[0].metrics.${MetricId.WallMs}`,
        (f) => ((f.lanes[0].metrics as Record<string, unknown>)[MetricId.WallMs] = [1, 2]),
      ],
      [
        `lanes[0].metrics.${MetricId.WallMs}`,
        (f) => ((f.lanes[0].metrics as Record<string, unknown>)[MetricId.WallMs] = ["1", 2, 3]),
      ],
    ];
    for (const [field, edit] of table) {
      const file = structuredClone(valid);
      edit(file);
      assert.throws(
        () => parseBaseline(JSON.stringify(file)),
        (error: unknown) => error instanceof BaselineError && error.field === field,
        field,
      );
    }
  });
});
