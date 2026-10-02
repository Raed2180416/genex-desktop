// Explicit opt-in local model acceptance. No subscription CLI or OS credentials.
import { spawn } from "node:child_process";
import path from "node:path";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
import { startFakeOllama } from "../helpers/fake-ollama.ts";

const root = process.argv[2];
if (!root) throw new Error("Pass the isolated validation root containing runtime/");
const model = process.argv[3] ?? "bonsai-2:27b-pq2_0";
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
    `--ollama-host=${fixture.host}`,
    `--studio-bonsai-acceptance=${path.resolve(root)}`,
    `--bonsai-model=${model}`,
  ]),
  { env: fixtureElectronEnv(), stdio: "inherit" },
);
const timer = setTimeout(() => child.kill("SIGTERM"), 20 * 60_000);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code ?? 1));
    child.once("error", reject);
  });
} finally {
  clearTimeout(timer);
  await fixture.close();
}
