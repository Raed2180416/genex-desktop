#!/usr/bin/env node
/**
 * The eval fixture pipeline end to end, with no provider and no network (plan M2.7, §13.8):
 * `npm run test:eval-fixture` (builds first) or `npm run test:ui -- eval-fixture`. Fixture lanes
 * A/D launch the built app through the Electron smoke sub-runner, B/C replay the stub CLIs; then
 * fixture grading, the report, and a version-axis `check` that must flag the candidate's seeded
 * boot break. The evals home is a disposable folder outside any repository (kept on failure or with
 * `--keep-home`); the evidence goes to `.studio-dev/evidence/eval-fixture/<stamp>/`.
 * `--scripted-probe` skips Chromium even when it launches (the path taken when it does not).
 * Needs a logged-in macOS GUI session, like every Electron runner.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testEvidence } from "../../scripts/test-evidence.mjs";
import { runEvalFixturePipeline } from "./eval-fixture-pipeline.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Set(process.argv.slice(2));
if (!fs.existsSync(path.join(repo, "dist", "main"))) {
  console.error("eval-fixture: no app build in dist/; run npm run test:eval-fixture, which builds first.");
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
const evidenceDir = testEvidence(path.join("eval-fixture", stamp));
const home = await mkdtemp(path.join(os.tmpdir(), "genex-eval-fixture-"));
console.log(`evals home ${home}`);
const started = Date.now();
const report = await runEvalFixturePipeline({
  repo,
  home,
  evidenceDir,
  userHome: os.homedir(),
  scriptedProbe: args.has("--scripted-probe"),
  out: (line) => console.log(line),
});
for (const failure of report.failures) console.log(`✖ ${failure}`);
console.log(
  `${report.ok ? "✔" : "✖"} eval fixture pipeline: ${report.steps.length} commands, probe ${report.probe.mode}, ` +
    `${Math.round((Date.now() - started) / 1000)}s`,
);
console.log(`evidence ${evidenceDir}`);
if (report.ok && !args.has("--keep-home")) {
  // The watcher's final snapshot clones are read-only; make them writable so the home can go.
  execFileSync("chmod", ["-R", "u+w", home]);
  await rm(home, { recursive: true, force: true });
} else console.log(`kept evals home ${home}`);
process.exitCode = report.ok ? 0 : 1;
