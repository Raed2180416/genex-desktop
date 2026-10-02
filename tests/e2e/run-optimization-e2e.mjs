import { optimizationEvidence } from "../../scripts/test-evidence.mjs";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const output = optimizationEvidence().root;
await mkdir(output, { recursive: true });
await rm(path.join(output, "summary.json"), { force: true });
const entry = path.join(output, "optimization-electron.mjs");
await build({
  entryPoints: [path.join(repo, "tests/e2e/optimization-electron.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["electron"],
});
const electron = resolveElectron(repo);
const child = spawn(electron, fixtureElectronArgs([entry]), {
  cwd: repo,
  stdio: "inherit",
  env: { ...fixtureElectronEnv(), AG931_REPO: repo, AG931_OUTPUT: output },
});
const timeout = setTimeout(() => {
  console.error("Optimization E2E exceeded 15 minutes");
  child.kill("SIGTERM");
}, 15 * 60_000);
process.once("SIGINT", () => child.kill("SIGTERM"));
const code = await new Promise((resolve) => {
  child.once("exit", resolve);
  child.once("error", (e) => {
    console.error(e);
    resolve(1);
  });
});
clearTimeout(timeout);
const summary = await readFile(path.join(output, "summary.json"), "utf8")
  .then(JSON.parse)
  .catch(() => null);
process.exitCode =
  code === 0 && summary?.passed === true && summary.cases?.length === (process.env.AG931_SAFETY_ONLY ? 14 : 3) ? 0 : 1;
