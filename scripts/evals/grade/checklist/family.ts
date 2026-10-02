/**
 * Grader families (Rule 19, D4): which engine speaks for which family, the default pair of graders,
 * and the pin checks every grade runs before its first call. Families are decided by the typed engine
 * id, never by reading a model name: a grade whose family shares the run's engine carries
 * `sameFamily: true`, and votes are never summed across families.
 */
import { EngineId } from "../../../../src/shared/providers.ts";
import { Effort, GraderFamily } from "../../vocabulary.ts";
import type { GraderPin } from "../types.ts";

/** The family each grading engine speaks for. A neutral family has no app engine yet (D4b). */
export const GRADER_FAMILY_BY_ENGINE: Partial<Record<EngineId, GraderFamily>> = {
  [EngineId.ClaudeCode]: GraderFamily.Claude,
  [EngineId.Codex]: GraderFamily.Gpt,
};

/** The default graders (D4): Claude Sonnet 5.5 and GPT-6.1-Sol, both at low effort. */
export const DEFAULT_GRADER_MODELS: ReadonlyArray<Omit<GraderPin, "promptSha">> = [
  { family: GraderFamily.Claude, engine: EngineId.ClaudeCode, model: "claude-sonnet-5-5", effort: Effort.Low },
  { family: GraderFamily.Gpt, engine: EngineId.Codex, model: "gpt-6.1-sol", effort: Effort.Low },
];

/** Why a set of grader pins was refused. */
export const GraderPinProblem = {
  NoGraders: "no-graders",
  FamilyTwice: "family-twice",
  EngineFamilyMismatch: "engine-family-mismatch",
  PromptShaMismatch: "prompt-sha-mismatch",
} as const;
export type GraderPinProblem = (typeof GraderPinProblem)[keyof typeof GraderPinProblem];

/** A grade refused before any call because its pins do not hold together. */
export class GraderPinError extends Error {
  readonly problem: GraderPinProblem;
  constructor(problem: GraderPinProblem) {
    super(`grader pins refused: ${problem}`);
    this.name = "GraderPinError";
    this.problem = problem;
  }
}

/** The default grader pins for a prompt template's sha. */
export function defaultGraderPins(promptSha: string): GraderPin[] {
  return DEFAULT_GRADER_MODELS.map((pin) => ({ ...pin, promptSha }));
}

/** The family a run's own engine belongs to, or null for an engine no grader family covers. */
export function familyOfEngine(engine: EngineId | null | undefined): GraderFamily | null {
  if (!engine) return null;
  return GRADER_FAMILY_BY_ENGINE[engine] ?? null;
}

/** Whether a grader grades its own family's output (carried, never refused). */
export function isSameFamily(pin: GraderPin, runEngines: ReadonlyArray<EngineId | null | undefined>): boolean {
  return runEngines.some((engine) => familyOfEngine(engine) === pin.family);
}

/** Refuse pins that would mix families, mislabel an engine or grade with another template. */
export function validateGraderPins(pins: readonly GraderPin[], promptSha: string): void {
  if (pins.length === 0) throw new GraderPinError(GraderPinProblem.NoGraders);
  const families = new Set(pins.map((pin) => pin.family));
  if (families.size !== pins.length) throw new GraderPinError(GraderPinProblem.FamilyTwice);
  if (pins.some((pin) => familyOfEngine(pin.engine) !== pin.family))
    throw new GraderPinError(GraderPinProblem.EngineFamilyMismatch);
  if (pins.some((pin) => pin.promptSha !== promptSha)) throw new GraderPinError(GraderPinProblem.PromptShaMismatch);
}
