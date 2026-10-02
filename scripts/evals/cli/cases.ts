/**
 * `cases [--check]` (§6.1): one line per public case and, when the private file exists, per
 * holdout: number, id, mode, exposure, visibility, deadline, checklist size and frozen version.
 * Reading the files already validates their grammar and exposure labels; `--check` also resolves
 * every edit case's start folder and prints a summary line. A malformed file names the case and
 * the field, and exits 1.
 */
import type { EvalCase } from "../case-types.ts";
import { CaseFileError, resolveStartFrom } from "../cases.ts";
import { CaseVisibility } from "../vocabulary.ts";
import { parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { CliExit, type Out } from "./exit.ts";

const MESSAGE = {
  usage: "usage: cases [--check]",
  invalid: "invalid",
  ok: "cases ok:",
} as const;

const CHECK_FLAG = "--check";

/** One case as a line. */
function caseLine(evalCase: EvalCase): string {
  const exposure = evalCase.exposureReason ? `${evalCase.exposure} (${evalCase.exposureReason})` : evalCase.exposure;
  return [
    `C${evalCase.number}`,
    evalCase.id,
    `mode=${evalCase.mode}`,
    `exposure=${exposure}`,
    `visibility=${evalCase.visibility}`,
    `deadline=${evalCase.deadlineMin}min`,
    `items=${evalCase.acceptance.length}`,
    `version=${evalCase.version}`,
  ].join(" ");
}

/** The cases, each edit case's start folder resolved when `check` is set; throws `CaseFileError`. */
function readChecked(ctx: CliContext, check: boolean): EvalCase[] {
  const cases = ctx.cases();
  if (check) for (const evalCase of cases.filter((c) => c.startFrom !== null)) resolveStartFrom(ctx.root, evalCase);
  return cases;
}

/** The `cases` command handler. */
export async function casesCommand(
  args: readonly string[],
  out: Out = console.log,
  given?: CliContext,
): Promise<number> {
  const parsed = parseCliArgs(args, { switches: [CHECK_FLAG] });
  if (parsed === null || parsed.positional.length > 0) {
    out(MESSAGE.usage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  const check = parsed.switches.has(CHECK_FLAG);
  let cases: EvalCase[];
  try {
    cases = readChecked(ctx, check);
  } catch (error) {
    if (!(error instanceof CaseFileError)) throw error;
    out(`${MESSAGE.invalid} ${error.message}`);
    return CliExit.Refused;
  }
  for (const evalCase of cases) out(caseLine(evalCase));
  if (check) {
    const holdouts = cases.filter((c) => c.visibility === CaseVisibility.Holdout).length;
    out(`${MESSAGE.ok} ${cases.length - holdouts} public, ${holdouts} holdout`);
  }
  return CliExit.Ok;
}
