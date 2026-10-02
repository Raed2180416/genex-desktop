/**
 * The comparator keeps genex-demo's honest limits: n = distinct cases (reps collapse to per-case
 * medians), n < 5 refuses with no delta field on the type, 5–7 claims a direction only, ≥ 8 prints
 * a magnitude in one fixed form; time, token and call metrics compare as ratios of geometric means.
 * Comparability refuses across a pinned difference the axis does not cover and across any
 * unavailable pin, while `na` compares equal. Hermetic: synthetic rows only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  armsRefusal,
  comparabilityKey,
  comparabilityRefusal,
  PinFactKind,
  PinField,
  pinFact,
} from "../../scripts/evals/report/comparability.ts";
import {
  BetterIs,
  ComparisonKind,
  cleanSweepStatement,
  compare,
  compareCases,
  compareRateCases,
  Direction,
  MetricScale,
  MINUS,
  NO_DETECTABLE_DIFFERENCE,
  pairByCase,
  renderComparison,
  renderRateComparison,
  sweepStatement,
} from "../../scripts/evals/report/compare.ts";
import { NOT_APPLICABLE, type RunRow, unavailable } from "../../scripts/evals/ledger/types.ts";
import { Axis, UnavailableReason } from "../../scripts/evals/vocabulary.ts";

const fixture = path.resolve(import.meta.dirname, "../fixtures/evals/report/run-row.json");
const baseRow = JSON.parse(fs.readFileSync(fixture, "utf8")) as RunRow;
const row = (edit: (row: RunRow) => void = () => {}): RunRow => {
  const copy = structuredClone(baseRow);
  edit(copy);
  return copy;
};

describe("compare: the floors live in the type", () => {
  it("refuses below five cases and the refused variant carries no delta", () => {
    const result = compare([2.6, 1.1, 4.15], [2.4, 1.3, 3.9], 3);
    assert.equal(result.kind, ComparisonKind.Refused);
    if (result.kind !== ComparisonKind.Refused) throw new Error("unreachable");
    assert.match(result.refusal, /below the N=5 floor/);
    assert.match(result.refusal, /no aggregate delta, percentage, arrow or colour/);
    assert.deepEqual(result.pairs[0], { a: 2.6, b: 2.4 });
    // @ts-expect-error: the refused variant carries no magnitude.
    const magnitude: unknown = result.observedPct;
    // @ts-expect-error: nor a direction.
    const direction: unknown = result.direction;
    assert.equal(magnitude, undefined);
    assert.equal(direction, undefined);
  });

  it("prints the raw pairs of a refusal and no percentage", () => {
    const rendered = renderComparison(compare([1, 2, 3, 4], [2, 3, 4, 5], 4), { labelA: "base", labelB: "cand" });
    assert.doesNotMatch(rendered, /%/);
    assert.match(rendered, /pairs \(base → cand\): 1 → 2 · 2 → 3 · 3 → 4 · 4 → 5/);
  });

  it("claims a direction at five to seven cases and never a magnitude", () => {
    const result = compare([1, 1, 1, 1, 1, 1], [2, 2, 3, 2, 2, 2], 6, { labelA: "before", labelB: "after" });
    assert.equal(result.kind, ComparisonKind.Direction);
    if (result.kind !== ComparisonKind.Direction) throw new Error("unreachable");
    assert.equal(result.direction, Direction.B);
    assert.equal(result.favouringB, 6);
    assert.match(result.statement, /Direction favours after \(6 of 6 pairs, higher is better\)/);
    assert.doesNotMatch(result.statement, /%/);
    // @ts-expect-error: direction is claimable at this n; magnitude is not.
    const magnitude: unknown = result.observedPct;
    assert.equal(magnitude, undefined);
  });

  it("flips the favoured arm when lower is better", () => {
    const cheaper = compare([2.6, 2.6, 2.6, 2.6, 2.6], [2.4, 2.5, 2.3, 2.4, 2.2], 5, {
      labelA: "baseline",
      labelB: "candidate",
      betterIs: BetterIs.Lower,
      metric: "cost",
    });
    if (cheaper.kind !== ComparisonKind.Direction) throw new Error("unreachable");
    assert.equal(cheaper.direction, Direction.B);
    assert.match(cheaper.statement, /cost: n=5/);
    assert.match(cheaper.statement, /Direction favours candidate \(5 of 5 pairs, lower is better\)/);
  });

  it("prints a magnitude at eight cases in exactly the fixed form", () => {
    const result = compare([1, 1, 1, 1, 1, 1, 1, 1], [1.2, 1.3, 1.4, 1.5, 1.6, 1.4, 1.3, 1.5], 8);
    if (result.kind !== ComparisonKind.Magnitude) throw new Error("unreachable");
    assert.equal(Math.round(result.observedPct), 40);
    assert.match(
      result.statement,
      /^observed \+40%, 95% CI \[\+29%, \+51%\], n=8 \(B against A, higher is better\)\. Direction favours B\.$/,
    );
  });

  it("uses the mandated phrase when the interval spans zero", () => {
    const result = compare([1, 1, 1, 1, 1, 1, 1, 1], [1.1, 0.9, 1.2, 0.8, 1.3, 0.7, 1.4, 0.6], 8);
    if (result.kind !== ComparisonKind.Magnitude) throw new Error("unreachable");
    assert.equal(result.spansZero, true);
    assert.match(result.statement, new RegExp(NO_DETECTABLE_DIFFERENCE));
    assert.doesNotMatch(result.statement, /significant/i);
  });

  it("prints negative percentages with U+2212", () => {
    const result = compare([2, 2, 2, 2, 2, 2, 2, 2], [1, 1.1, 0.9, 1.2, 0.8, 1, 1.1, 0.9], 8);
    if (result.kind !== ComparisonKind.Magnitude) throw new Error("unreachable");
    assert.equal(MINUS, "−");
    assert.match(result.statement, /observed −\d+%/);
  });

  it("degrades a zero baseline to a direction and calls zero variance degenerate", () => {
    const zero = compare([0, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 7, 8], 8);
    if (zero.kind !== ComparisonKind.Direction) throw new Error("unreachable");
    assert.match(zero.statement, /baseline mean is 0/);
    const flat = compare([1, 1, 1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2, 2, 2], 8);
    if (flat.kind !== ComparisonKind.Magnitude) throw new Error("unreachable");
    assert.match(flat.statement, /degenerate, not precise/);
  });

  it("refuses an n that disagrees with the data, or a non-finite value", () => {
    assert.throws(() => compare([1, 2], [1, 2, 3], 2), /n=2 but got 2 A-values and 3 B-values/);
    assert.throws(() => compare([1, Number.NaN], [1, 2], 2), /must be finite/);
  });
});

describe("compare: log scale and distinct cases", () => {
  it("reports a ratio of geometric means for a log metric", () => {
    const a = [100, 100, 100, 100, 100, 100, 100, 100];
    const b = [200, 200, 200, 200, 100, 100, 100, 100];
    const result = compare(a, b, 8, { scale: MetricScale.Log, betterIs: BetterIs.Lower, metric: "time.wallMs" });
    if (result.kind !== ComparisonKind.Magnitude) throw new Error("unreachable");
    assert.equal(Math.round(result.observedPct), 41);
    assert.deepEqual(result.ci95Pct.map(Math.round), [4, 93]);
    assert.equal(result.direction, Direction.A);
    assert.match(result.statement, /ratio of geometric means 1\.41/);
  });

  it("refuses a log metric with a non-positive value", () => {
    const result = compare([0, 1, 1, 1, 1], [1, 1, 1, 1, 1], 5, { scale: MetricScale.Log });
    if (result.kind !== ComparisonKind.Refused) throw new Error("unreachable");
    assert.match(result.refusal, /log scale needs positive values/);
  });

  it("collapses reps to per-case medians so reps never raise n", () => {
    const a = [
      { caseId: "c1", value: 1 },
      { caseId: "c1", value: 3 },
      { caseId: "c1", value: 100 },
      { caseId: "c2", value: 4 },
      { caseId: "c3", value: 9 },
    ];
    const b = [
      { caseId: "c2", value: 5 },
      { caseId: "c1", value: 2 },
      { caseId: "c1", value: 2 },
    ];
    assert.deepEqual(pairByCase(a, b), { caseIds: ["c1", "c2"], a: [3, 4], b: [2, 5] });
    const many = Array.from({ length: 12 }, (_, rep) => ({ caseId: "only", value: rep }));
    const result = compareCases(many, many);
    assert.equal(result.n, 1);
    assert.equal(result.kind, ComparisonKind.Refused);
  });
});

describe("compare: rates pool pass counts by case (Mantel–Haenszel), never per-case medians", () => {
  /** `cases` cases, each arm running its reps as given (1 booted, 0 not). */
  const arm = (cases: number, reps: readonly number[]) =>
    Array.from({ length: cases }, (_, i) => reps.map((value) => ({ caseId: `c${i + 1}`, value }))).flat();
  const options = { labelA: "A", labelB: "B", metric: "rate.boot", betterIs: BetterIs.Higher };

  it("sees a regression of one rep in three in every case, which medians of 0/1 hide", () => {
    const result = compareRateCases(arm(8, [1, 1, 1]), arm(8, [1, 1, 0]), options);
    assert.equal(result.kind, ComparisonKind.Magnitude);
    assert.equal(result.n, 8);
    assert.deepEqual(
      [result.pooled?.a.passes, result.pooled?.a.runs, result.pooled?.b.passes, result.pooled?.b.runs],
      [24, 24, 16, 24],
    );
    assert.equal(result.oddsRatio, null, "A never failed: no discordance the other way");
    assert.equal(result.direction, Direction.A);
    assert.match(result.statement, /odds ratio not estimable/);
    assert.match(result.statement, /Direction favours A/);
    const text = renderRateComparison(result, options);
    assert.doesNotMatch(text, /\+0%|no difference large enough/);
    assert.match(text, /A 24\/24 \(100%, 95% CI 86–100%\) · B 16\/24 \(67%, 95% CI 47–82%\)/);
    assert.match(text, /cases \(A → B\): 3\/3 → 2\/3/);
  });

  it("pools a finite odds ratio and its interval when both arms have mixed outcomes", () => {
    const result = compareRateCases(arm(8, [1, 1, 0]), arm(8, [1, 0, 0]), options);
    assert.ok(result.oddsRatio !== null && Math.abs(result.oddsRatio - 0.25) < 1e-9);
    assert.ok(
      result.ci95 !== null && Math.abs(result.ci95.lo - 0.0753) < 1e-3 && Math.abs(result.ci95.hi - 0.83) < 1e-3,
    );
    assert.equal(result.direction, Direction.A);
    assert.match(result.statement, /Mantel–Haenszel odds ratio 0\.25, 95% CI \[0\.08, 0\.83\], n=8 cases/);
    const even = compareRateCases(arm(8, [1, 0]), arm(8, [1, 0]), options);
    assert.match(even.statement, new RegExp(NO_DETECTABLE_DIFFERENCE));
  });

  it("keeps the case floors: a direction only at 5–7 cases, a refusal below 5", () => {
    const direction = compareRateCases(arm(6, [1, 1, 1]), arm(6, [1, 1, 0]), options);
    assert.equal(direction.kind, ComparisonKind.Direction);
    assert.equal(direction.direction, Direction.A);
    assert.match(direction.statement, /n=6 — direction may be claimed, magnitude may not\. Direction favours A/);
    const refused = compareRateCases(arm(3, [1]), arm(3, [0]), options);
    assert.equal(refused.kind, ComparisonKind.Refused);
    assert.equal(refused.pooled, null);
    assert.match(refused.statement, /rate\.boot: n=3 is below the N=5 floor/);
    assert.throws(() => compareRateCases([{ caseId: "c1", value: 0.5 }], [], options), TypeError);
  });
});

describe("sweeps", () => {
  it("states a clean sweep by the exact zero-failure bound, never a checkmark", () => {
    assert.equal(cleanSweepStatement(8), "8/8 clean is consistent with a failure rate as high as 31%");
    assert.equal(sweepStatement(6, 8), "6/8 passed — 75%, 95% CI [41%, 93%] (Wilson)");
    assert.equal(sweepStatement(8, 8), cleanSweepStatement(8));
  });
});

describe("comparability", () => {
  it("normalises pin facts: numbers, lists, n/a and unavailable", () => {
    assert.deepEqual(pinFact(60000), { kind: PinFactKind.Measured, value: "60000" });
    assert.deepEqual(pinFact(["b", "a"]), { kind: PinFactKind.Measured, value: "a+b" });
    assert.deepEqual(pinFact(NOT_APPLICABLE), { kind: PinFactKind.NotApplicable });
    assert.deepEqual(pinFact(null), { kind: PinFactKind.Unavailable, reason: UnavailableReason.NotRecorded });
    assert.deepEqual(pinFact(unavailable(UnavailableReason.CliUnreported)), {
      kind: PinFactKind.Unavailable,
      reason: UnavailableReason.CliUnreported,
    });
  });

  it("compares two runs of one lane and refuses across a CLI version", () => {
    const key = comparabilityKey(row());
    assert.equal(comparabilityRefusal(key, key, null), null);
    const other = comparabilityKey(row((r) => (r.pins.run.cliVersion = "2.1.301")));
    const refusal = comparabilityRefusal(key, other, Axis.Version);
    assert.ok(refusal);
    assert.match(refusal.text, /refusing to compare/);
    assert.match(refusal.text, /run\.cliVersion: 2\.1\.300 vs 2\.1\.301/);
    assert.match(refusal.text, /not the declared axis \(version\)/);
    assert.equal(comparabilityRefusal(key, other, Axis.Cli), null);
  });

  it("lets the version axis move the app build and nothing else", () => {
    const base = comparabilityKey(row());
    const candidate = comparabilityKey(
      row((r) => {
        r.pins.run.appSha = "3333333333333333333333333333333333333333";
        r.pins.run.buildId = "999999999999";
      }),
    );
    assert.equal(comparabilityRefusal(base, candidate, Axis.Version), null);
    assert.ok(comparabilityRefusal(base, candidate, Axis.ModelStack));
  });

  it("treats n/a as equal and unavailable as a refusal, even on the axis", () => {
    const genex = comparabilityKey(row());
    const raw = comparabilityKey(
      row((r) => {
        r.lane.id = "raw-claude";
        r.lane.harnessPin = "999999999999";
        r.pins.run.appSha = NOT_APPLICABLE;
        r.pins.run.buildId = NOT_APPLICABLE;
        r.pins.run.harnessSeedDigest = NOT_APPLICABLE;
        r.pins.run.instructionSha = "999999999999";
        r.pins.run.laneWrapperDigest = "999999999999";
        r.pins.run.containmentDigest = "999999999999";
        r.lane.browser = "look-at-page";
      }),
    );
    assert.equal(comparabilityRefusal(genex, raw, Axis.ProductDefault), null);
    const blind = comparabilityKey(row((r) => (r.pins.run.appSha = unavailable(UnavailableReason.NotRecorded))));
    const refusal = comparabilityRefusal(genex, blind, Axis.Version);
    assert.ok(refusal);
    assert.equal(refusal.differences[0].field, PinField.AppSha);
    assert.match(refusal.text, /run\.appSha: 1{40} vs unavailable \(not-recorded\)/);
  });

  it("refuses across a grading pin on every axis", () => {
    const key = comparabilityKey(row());
    const regraded = comparabilityKey(row((r) => (r.pins.grading.graderPromptSha = "999999999999")));
    for (const axis of Object.values(Axis)) assert.ok(comparabilityRefusal(key, regraded, axis), axis);
  });

  it("checks arms case by case, so different cases never refuse each other", () => {
    const caseTwo = (r: RunRow) => {
      r.case.id = "case-two";
      r.case.version = "999999999999";
    };
    const a = [row(), row(caseTwo)];
    const b = [row((r) => (r.pins.run.appSha = "4444444444444444444444444444444444444444")), row(caseTwo)];
    assert.equal(armsRefusal(a, b, Axis.Version), null);
    const drifted = [row(), row((r) => (r.model.effort = "low"))];
    assert.match(armsRefusal(drifted, b, Axis.Version)?.text ?? "", /model\.effort: high vs low/);
  });
});
