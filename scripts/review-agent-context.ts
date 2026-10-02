import { pathToFileURL } from "node:url";
import { matches, readKnowledgeMap } from "./check-agent-context.ts";
import { changedFiles, selectTests } from "./affected-tests.mjs";

const USAGE =
  "Usage: npm run review:context -- --area ID | --files A B ... | --changed [BASE] (read-only; no --outcome/--reason/--task receipts)";

/** Read-only routing. No fingerprints or review receipts are written. */
export function reviewContext(root: string, id: string): string {
  const area = readKnowledgeMap(root).areas.find((area) => area.id === id);
  if (!area) throw new Error(`Unknown area: ${id}`);
  const handbook = area.documents.filter((doc) => doc === "docs/agent/context.md" || doc.startsWith("docs/product/"));
  const references = area.documents.filter((doc) => !handbook.includes(doc) && !doc.startsWith(".agents/"));
  return [
    area.id,
    "Product handbook (choose the affected page):",
    ...handbook.map((doc) => `  ${doc}`),
    "Technical references (search only the section needed; design.md routes skills):",
    ...references.map((doc) => `  ${doc}`),
    "Available checks (select by changed behavior):",
    ...area.commands.map((command) => `  npm run ${command}`),
    "Update owning docs in place, or explain in the PR why they remain accurate. No files changed.",
  ].join("\n");
}

/** Route a set of changed files: the knowledge-map areas that own them, then the tests they reach. */
export function reviewFiles(root: string, files: string[]): string {
  const areas = readKnowledgeMap(root).areas;
  const owned = areas.filter((area) => files.some((file) => area.sources.some((glob) => matches(file, glob))));
  const unowned = files.filter((file) => !areas.some((area) => area.sources.some((glob) => matches(file, glob))));
  const { L1, L3, unmatched } = selectTests(root, files);
  return [
    `${files.length} changed file(s) → ${owned.length} area(s)`,
    ...owned.map((area) => reviewContext(root, area.id)),
    ...(unowned.length ? [`Not owned by any area: ${unowned.join(" ")}`] : []),
    [`Affected tests L1 (${L1.length}; npm run check runs them):`, ...L1.map((test: string) => `  ${test}`)].join("\n"),
    [
      `Affected tests L3 (${L3.length}; rig suites and the harness gate, serial):`,
      ...L3.map((test: string) => `  ${test}`),
    ].join("\n"),
    ...(unmatched.length ? [`No test reaches: ${unmatched.join(" ")}`] : []),
  ].join("\n\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...rest] = process.argv.slice(2),
    root = process.cwd();
  if (mode === "--area" && rest.length === 1 && rest[0]) console.log(reviewContext(root, rest[0]));
  else if (mode === "--files" && rest.length) console.log(reviewFiles(root, rest));
  else if (mode === "--changed" && rest.length <= 1)
    console.log(reviewFiles(root, changedFiles(root, { base: rest[0] })));
  else throw new Error(USAGE);
}
