import { testEvidence } from "../../scripts/test-evidence.mjs";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
/**
 * The five shapes, end to end: `npm run test:shapes:e2e`.
 *
 * Bundles the Electron program, runs it in the pinned Electron, and refuses to pass unless the
 * summary it wrote says so and carries every entry that was asked for. Modelled on the
 * optimization pair, flags and all: `--only <id>[,<id>]`, `--engine fixture|codex|claude|all`,
 * `--out <dir>`, `--keep` (leave the temp copies and print where they are).
 *
 * No model of any kind is started, and no `--ollama-host` is passed.
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = ["inline-raf", "esm-addons", "bundled-ts", "menu-levels", "webgpu-field"];
const TRANSPORTS = ["fixture", "codex", "claude"];

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : "true";
}

const only = (flag("only") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const asked = only.length ? only : FIXTURES;
for (const id of asked)
  if (!FIXTURES.includes(id)) throw new Error(`no fixture called "${id}" — one of ${FIXTURES.join(", ")}`);
const engineFlag = flag("engine", "all");
const transports =
  engineFlag === "all"
    ? TRANSPORTS
    : engineFlag
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
for (const name of transports)
  if (!TRANSPORTS.includes(name)) throw new Error(`no transport called "${name}" — one of ${TRANSPORTS.join(", ")}`);

const output = testEvidence("shapes", flag("out") ?? process.env.STUDIO_SHAPES_OUT);
await mkdir(output, { recursive: true });
await rm(path.join(output, "summary.json"), { force: true });

const entry = path.join(output, "shapes-electron.mjs");
await build({
  entryPoints: [path.join(repo, "tests/e2e/shapes-electron.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // The studio's own modules are bundled; everything from node_modules is resolved by Electron
  // at run time, because a CJS dependency that requires "crypto" dynamically cannot be bundled.
  packages: "external",
  external: ["electron"],
});

const electron = resolveElectron(repo);
const child = spawn(electron, fixtureElectronArgs([entry]), {
  cwd: repo,
  stdio: "inherit",
  env: {
    ...fixtureElectronEnv(),
    STUDIO_SHAPES_REPO: repo,
    STUDIO_SHAPES_OUT: output,
    // Empty means "every fixture, and the pages the runner carries for the capture lane".
    STUDIO_SHAPES_ONLY: only.join(","),
    STUDIO_SHAPES_ENGINES: transports.join(","),
    ...(flag("keep") ? { STUDIO_SHAPES_KEEP: "1" } : {}),
  },
});
const timeout = setTimeout(() => {
  console.error("Shapes E2E exceeded 12 minutes");
  child.kill("SIGTERM");
}, 12 * 60_000);
process.once("SIGINT", () => child.kill("SIGTERM"));
const code = await new Promise((resolve) => {
  child.once("exit", resolve);
  child.once("error", (err) => {
    console.error(err);
    resolve(1);
  });
});
clearTimeout(timeout);

const summary = await readFile(path.join(output, "summary.json"), "utf8")
  .then(JSON.parse)
  .catch(() => null);
const expected = asked.flatMap((id) => transports.map((transport) => `${id}/${transport}`));
const present = new Set((summary?.entries ?? []).map((entry) => `${entry.id}/${entry.transport}`));
const missing = expected.filter((key) => !present.has(key));
if (missing.length)
  console.error(
    `shapes summary is missing ${missing.length} entr${missing.length === 1 ? "y" : "ies"}: ${missing.join(", ")}`,
  );
if (summary?.unverified?.length) for (const note of summary.unverified) console.warn(`unverified: ${note}`);
process.exitCode = code === 0 && summary?.passed === true && missing.length === 0 ? 0 : 1;
