// Explicit opt-in. Real subscription CLIs and an already verified Bonsai installation.
// No asset generation, publishing or user-profile reset. Native CLIs use their existing
// sign-in; mock encryption and disabled Studio credentials apply only to this fixture app.
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
import { startFakeOllama } from "../helpers/fake-ollama.ts";
const root = process.argv[2];
if (!root || !process.argv.includes("--live"))
  throw new Error("Usage: node tests/e2e/run-provider-live.mjs <root-with-runtime> --live [--packaged]");
const profile = await mkdtemp(path.join(os.tmpdir(), "studio-provider-acceptance-"));
const packaged = process.argv.includes("--packaged");
const executable = packaged
  ? path.resolve(process.env.STUDIO_PACKAGE_DIR ?? "out/Genex-darwin-arm64", "Genex.app/Contents/MacOS/genex")
  : resolveElectron();
const fixture = await startFakeOllama({ replies: [] });
const child = spawn(
  executable,
  fixtureElectronArgs([
    ...(packaged ? [] : ["."]),
    "--studio-smoke",
    `--userdata=${profile}`,
    `--ollama-host=${fixture.host}`,
    `--studio-provider-acceptance=${path.resolve(root)}`,
  ]),
  {
    env: { ...fixtureElectronEnv(), STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS: "1", STUDIO_LIVE_CLAUDE_CLI: "1" },
    stdio: "inherit",
  },
);
const timeout = setTimeout(() => child.kill("SIGTERM"), 15 * 60000);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code ?? 1));
    child.once("error", reject);
  });
} finally {
  clearTimeout(timeout);
  await fixture.close();
}
