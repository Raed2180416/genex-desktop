import path from "node:path";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { BonsaiRuntime } from "../../src/substrate/bonsai/runtime.ts";
import { BonsaiEngine } from "../../src/substrate/engines/bonsai.ts";
// Explicit opt-in capacity test. Uses an already installed, isolated runtime; no downloads.
// A cold near-100K prompt can take 15–25 minutes on older Apple Silicon.
if (!process.argv[2]) throw new Error("Usage: node tests/e2e/run-bonsai-context.mjs <validation-root-with-runtime>");
const root = path.resolve(process.argv[2]);
const runtime = new BonsaiRuntime(path.join(root, "runtime"));
const engine = new BonsaiEngine({ root: path.join(root, "context-engine"), runtime });
const report = {
  model: "bonsai-2:27b-pq2_0",
  contextWindow: runtime.contextWindow,
  startedAt: new Date().toISOString(),
  samples: [],
};
let monitor;
try {
  const start = Date.now();
  const host = await runtime.start(report.model, AbortSignal.timeout(180000));
  report.startupMs = Date.now() - start;
  report.pid = runtime.processId;
  const sample = () => {
    try {
      const rssKiB = Number(
        execFileSync("/bin/ps", ["-o", "rss=", "-p", String(runtime.processId)], { encoding: "utf8" }).trim(),
      );
      report.samples.push({ elapsedMs: Date.now() - start, rssKiB });
    } catch {}
  };
  sample();
  monitor = setInterval(sample, 15000);
  console.log(
    JSON.stringify({
      stage: "ready",
      contextWindow: runtime.contextWindow,
      startupMs: report.startupMs,
      pid: runtime.processId,
      rssKiB: report.samples.at(-1).rssKiB,
    }),
  );
  const post = async (route, body) => {
    const r = await fetch(host + route, {
      method: "POST",
      headers: { ...runtime.authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  const content =
    "Remember the marker near the beginning: COPPER-RAVEN-729. The following is filler for a context-capacity test.\n" +
    " hello".repeat(99000) +
    "\nEnd of filler. Reply only with the marker from the beginning, without explanation.";
  const messages = [{ role: "user", content }];
  const templated = await post("/apply-template", { messages });
  const tokens = await post("/tokenize", { content: templated.prompt, add_special: true, parse_special: true });
  report.promptTokens = tokens.tokens.length;
  console.log(JSON.stringify({ stage: "generating", promptTokens: report.promptTokens }));
  const inferenceStart = Date.now();
  const result = await engine.complete({
    model: report.model,
    messages,
    maxTokens: 512,
    effort: "low",
    timeoutMs: 25 * 60000,
  });
  report.inferenceMs = Date.now() - inferenceStart;
  report.answer = result.message.content;
  report.usage = result.usage;
  report.stopReason = result.stopReason;
  report.ok = result.message.content.includes("COPPER-RAVEN-729");
  sample();
  console.log(
    JSON.stringify({
      stage: "complete",
      ok: report.ok,
      answer: report.answer,
      inferenceMs: report.inferenceMs,
      usage: report.usage,
      peakRssGiB: Math.max(...report.samples.map((s) => s.rssKiB)) / 1024 ** 2,
    }),
  );
} catch (e) {
  report.ok = false;
  report.error = String(e);
  console.log(JSON.stringify({ stage: "failed", error: report.error }));
  process.exitCode = 1;
} finally {
  clearInterval(monitor);
  await runtime.dispose();
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, "context-100k-report.json"), JSON.stringify(report, null, 2) + "\n");
}
