/**
 * A node:test reporter for scripts/test-windows.mjs: one JSON line per finished test or suite,
 * `{ file, suite, outcome }`, plus the `name` and clipped `error` of a failure. A skipped or todo
 * test counts as a skip whatever its result, and a file that crashes before its tests run reports
 * one failure named after the file.
 */

/** How one finished test ended, in its wire spelling. */
export const TestOutcome = Object.freeze({ Pass: "pass", Fail: "fail", Skip: "skip" });

/** How much of a failure's message a line keeps: enough to classify it from the CI artifact. */
export const ERROR_CHARS = 1_500;

/** The reporter itself: node:test events in, JSON lines out. */
export default async function* reportOutcomes(source) {
  for await (const event of source) {
    const outcome = outcomeOf(event);
    if (!outcome) continue;
    const { data } = event;
    const row = { file: data.file ?? data.name, suite: data.details?.type === "suite", outcome };
    if (outcome === TestOutcome.Fail) Object.assign(row, { name: data.name, error: failureText(data.details?.error) });
    yield `${JSON.stringify(row)}\n`;
  }
}

function outcomeOf({ type, data }) {
  if (type !== "test:pass" && type !== "test:fail") return null;
  if (data.skip || data.todo) return TestOutcome.Skip;
  return type === "test:fail" ? TestOutcome.Fail : TestOutcome.Pass;
}

/** The assertion or crash behind a failure: node:test wraps it as the `cause` of its own error. */
function failureText(error) {
  const reason = error?.cause ?? error;
  if (!reason) return "";
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.slice(0, ERROR_CHARS);
}
