import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
import { startFakeOllama } from "../helpers/fake-ollama.ts";
import { packagedApp } from "./packaged-app.mjs";
const { bin: executable } = packagedApp(path.resolve("."));
const fake = await startFakeOllama({ respond: () => ({ text: "Terminal fixture" }) });
const child = spawn(
  executable,
  fixtureElectronArgs(["--studio-smoke", "--studio-terminal-smoke", `--ollama-host=${fake.host}`]),
  { env: fixtureElectronEnv(), stdio: ["ignore", "pipe", "pipe"] },
);
let stdout = "",
  stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
try {
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  const match = /__TERMINAL_JSON__([\s\S]*?)__END__/.exec(stdout);
  if (!match) throw new Error(`Packaged terminal produced no report (exit ${code}). ${stderr.slice(-3000)}`);
  const report = JSON.parse(match[1]);
  await fs.mkdir(".studio-dev/evidence", { recursive: true });
  await fs.writeFile(".studio-dev/evidence/terminal-packaged.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (code !== 0 || report.failed) process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await fake.close();
}
