// The project's TypeScript compiler: `node scripts/tsc.ts <tsc args>` runs the `tsc` bin of the
// `typescript` package itself (TypeScript 7, a JS shim that execs the native compiler).
// node_modules/.bin/tsc is not trusted: @typescript/typescript6, which keeps the 6.0 JS API for the
// scripts and tests that walk source or build programs, depends on typescript@6 under an alias, and
// that package's `tsc` can win the .bin link.
//
// Without `-p`/`--project` it checks both projects: the app (tsconfig.json) and the in-app harness
// (tsconfig.harness.json, which extends the seed's own src/harness-seed/tsconfig.json — the seed is
// copied into the agent's workspace and checked there on its own terms, so the app's project leaves
// it out). An incremental build keeps one build-info file per project.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { packageBin } from "./package-bin.ts";

export const PROJECTS = ["tsconfig.json", "tsconfig.harness.json"] as const;

/** The tsc argument lists one run makes: as given with a project named, else one per project. */
export function tscRuns(args: readonly string[]): string[][] {
  if (args.some((arg) => arg === "-p" || arg === "--project" || arg.startsWith("--project="))) return [[...args]];
  return PROJECTS.map((project, index) => {
    const own = args.map((arg, at) => {
      if (index === 0 || args[at - 1] !== "--tsBuildInfoFile") return arg;
      return arg.replace(/(\.tsbuildinfo)?$/, (ext) => `.harness${ext}`);
    });
    return ["-p", project, ...own];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Every project is checked even after one fails, so one run reports every error.
  for (const run of tscRuns(process.argv.slice(2))) {
    const result = spawnSync(process.execPath, [packageBin("typescript", "tsc"), ...run], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
}
