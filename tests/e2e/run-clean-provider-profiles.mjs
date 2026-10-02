import { testEvidence } from "../../scripts/test-evidence.mjs";
/** Fresh HOME + app profile; actual locally installed CLIs, no model requests or account mutation.
 * Not a separate macOS account: the system keychain remains shared. */
import { mkdtemp, mkdir, symlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
if (process.env.STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS !== "1")
  throw new Error(
    "This test launches real coding CLIs and may access macOS Keychain despite its temporary HOME. It requires explicit account-holder permission; set STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS=1 only after obtaining it.",
  );
const codex = process.env.STUDIO_ACCEPT_CODEX,
  claude = process.env.STUDIO_ACCEPT_CLAUDE;
if (!codex || !claude)
  throw new Error(
    "Supply STUDIO_ACCEPT_CODEX and STUDIO_ACCEPT_CLAUDE absolute paths for existing external installations.",
  );
const app = path.resolve("out/Genex-darwin-arm64/Genex.app/Contents/MacOS/genex");
const reports = [];
for (const selected of [[], ["codex"], ["codex", "claude-code"]]) {
  const home = await mkdtemp(path.join(os.tmpdir(), "studio-clean-home-"));
  try {
    const bin = path.join(home, ".local/bin");
    await mkdir(bin, { recursive: true });
    await symlink(process.execPath, path.join(bin, "node"));
    await symlink(path.join(path.dirname(process.execPath), "npm"), path.join(bin, "npm"));
    for (const provider of selected)
      await symlink(provider === "codex" ? codex : claude, path.join(bin, provider === "codex" ? "codex" : "claude"));
    const env = { ...process.env, HOME: home, PATH: "/usr/bin:/bin", ZDOTDIR: home };
    for (const key of [
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "ELECTRON_RUN_AS_NODE",
    ])
      delete env[key];
    const args = [
      "--studio-smoke",
      `--userdata=${path.join(home, "profile")}`,
      ...["codex", "claude-code"].map(
        (provider) => `--studio-expected-${provider}=${selected.includes(provider) ? "ready" : "missing"}`,
      ),
    ];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(app, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "",
        err = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), 150000);
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err = (err + b).slice(-6000)));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out, err });
      });
    });
    const match = /__SMOKE_JSON__([\s\S]*?)__END__/.exec(result.out);
    const report = match ? JSON.parse(match[1]) : null;
    reports.push({ providers: selected, exit: result.code, report, ...(!report ? { stderr: result.err } : {}) });
    if (result.code !== 0 || !report || report.failed)
      throw new Error(`Clean profile ${selected.join("+") || "none"} failed: ${JSON.stringify(reports.at(-1))}`);
    console.log(`PASS clean HOME/profile: ${selected.join("+") || "no coding CLIs"} (${report.checks.length} checks)`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
const output = testEvidence("clean-provider-profiles");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
