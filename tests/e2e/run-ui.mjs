#!/usr/bin/env node
// L4 dispatcher: `npm run test:ui -- <name> [runner args]` builds once, then runs tests/e2e/run-<name>.mjs.
// `npm run test:ui` (no name) or `--list` prints the runners without building.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
// Live providers, accounts, the network or a packaged app: run these directly, only with explicit permission.
const DIRECT_ONLY = new Set([
  "provider-live",
  "bonsai-live",
  "clean-provider-profiles",
  "public-catalog",
  "packaged-smoke",
  "terminal-packaged",
]);
const runners = fs
  .readdirSync(here)
  .filter((file) => /^run-.+\.mjs$/.test(file) && file !== "run-ui.mjs")
  .map((file) => file.slice(4, -4))
  .sort();
const [name, ...rest] = process.argv.slice(2);
const list = () =>
  console.log(
    `Runners (npm run test:ui -- <name>):\n${runners
      .filter((r) => !DIRECT_ONLY.has(r))
      .map((r) => `  ${r}`)
      .join(
        "\n",
      )}\nDirect only, with explicit permission:\n${[...DIRECT_ONLY].map((r) => `  node tests/e2e/run-${r}.mjs`).join("\n")}`,
  );
if (!name || name === "--list") {
  list();
  process.exit(name ? 0 : 2);
}
if (DIRECT_ONLY.has(name)) {
  console.error(
    `test:ui: ${name} touches live providers, accounts, the network or a packaged app; run node tests/e2e/run-${name}.mjs directly with explicit permission.`,
  );
  process.exit(2);
}
if (!runners.includes(name)) {
  console.error(`test:ui: unknown runner "${name}".`);
  list();
  process.exit(2);
}
const run = (args) => spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" }).status ?? 1;
const built = run(["scripts/build.mjs"]);
if (built !== 0) process.exit(built);
process.exit(run([`tests/e2e/run-${name}.mjs`, ...rest]));
