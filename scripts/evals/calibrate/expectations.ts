/**
 * What each calibration fixture must score (§8.8), asserted rather than printed: a calibration that
 * has to be eyeballed is one nobody runs twice. Null fixtures may pass L1 (they really do load), but
 * never L2 and never a checklist item. `template-untouched` must be typed `noBuild`, and the
 * known-good mini-golf must pass L2 and most of its checklist. A void grade is never a green check.
 */
import { CalibrationFixture, CheckResult, NoBuild } from "../vocabulary.ts";
import type { CalibrationCheck } from "../grade/types.ts";

/** The lowest checklist score the known-good fixture may get: 6 of the mini-golf case's 8 items. */
export const KNOWN_GOOD_MIN_CHECKLIST = 0.75;

/** Each fixture's expectation. `l2: fail` means "never pass"; a prober that cannot tell is not a pass. */
export const CALIBRATION_EXPECTATIONS: Readonly<Record<CalibrationFixture, CalibrationCheck["expected"]>> = {
  [CalibrationFixture.EmptyCanvas]: { l2: CheckResult.Fail, checklistMax: 0, noBuild: null },
  [CalibrationFixture.PlaceholderOnly]: { l2: CheckResult.Fail, checklistMax: 0, noBuild: null },
  [CalibrationFixture.BrokenBuild]: { l2: CheckResult.Fail, checklistMax: 0, noBuild: NoBuild.BuildFailed },
  [CalibrationFixture.TemplateUntouched]: { l2: CheckResult.Fail, checklistMax: 0, noBuild: NoBuild.TemplateUntouched },
  [CalibrationFixture.KnownGoodMiniGolf]: { l2: CheckResult.Pass, checklistMax: 1, noBuild: null },
};

/** Whether the L2 gate met its expectation. */
function l2Holds(expected: CheckResult, actual: CheckResult): boolean {
  if (expected === CheckResult.Pass) return actual === CheckResult.Pass;
  return actual !== CheckResult.Pass;
}

/** Whether the checklist score met its expectation; an ungraded known-good fixture never does. */
function checklistHolds(fixture: CalibrationFixture, expected: number, actual: number | null): boolean {
  if (fixture === CalibrationFixture.KnownGoodMiniGolf) return actual !== null && actual >= KNOWN_GOOD_MIN_CHECKLIST;
  return (actual ?? 0) <= expected;
}

/** One fixture's check: its expectation against what the prober and the grader said. */
export function checkFixture(
  fixture: CalibrationFixture,
  actual: CalibrationCheck["actual"],
  gradeVoid: boolean,
): CalibrationCheck {
  const expected = CALIBRATION_EXPECTATIONS[fixture];
  const holds =
    l2Holds(expected.l2, actual.l2) &&
    checklistHolds(fixture, expected.checklistMax, actual.checklist) &&
    expected.noBuild === actual.noBuild;
  return { fixture, expected, actual, ok: holds && !gradeVoid };
}
