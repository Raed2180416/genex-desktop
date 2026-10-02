import "./check-node.mjs";
import { spawnSync } from "node:child_process";

// Explicit files replace the default suite instead of being appended to it by npm.
// `--group fast` runs every test outside the rig with Node's default parallelism; `--group rig`
// runs the tests that reach tests/helpers/studio-rig.ts one at a time. `--list` prints the group.
const args = process.argv.slice(2);
const at = args.indexOf("--group"),
  list = args.includes("--list");
let command;
if (at >= 0) {
  const group = args[at + 1];
  if (group !== "fast" && group !== "rig") throw new Error("--group must be fast or rig");
  const { rigTests, testFiles, importGraph } = await import("./affected-tests.mjs");
  const root = process.cwd(),
    tests = testFiles(root),
    rigs = new Set(rigTests(root, importGraph(root, tests), tests));
  const files = tests.filter((t) => rigs.has(t) === (group === "rig"));
  const rest = args.filter((a, i) => i !== at && i !== at + 1 && a !== "--list");
  if (list) {
    console.log(files.join("\n"));
    console.error(`${group}: ${files.length} of ${tests.length} test files`);
    process.exit(0);
  }
  command = ["--test", ...(group === "rig" ? ["--test-concurrency=1"] : []), "--test-reporter=spec", ...rest, ...files];
} else {
  command = [
    "--test",
    "--test-concurrency=1",
    "--test-reporter=spec",
    ...(args.length ? args : ["tests/**/*.test.ts"]),
  ];
}
const { TEST_PRELOAD, testEnv } = await import("./affected-tests.mjs");
const result = spawnSync(process.execPath, [...TEST_PRELOAD, ...command], { stdio: "inherit", env: testEnv() });
if (result.error) console.error(result.error.message);
if (result.signal) console.error(`Node tests terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
