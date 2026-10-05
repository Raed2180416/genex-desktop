/** Opt-in live acceptance, reachable only from an isolated --studio-smoke launch. */
import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sleep } from "./wait.ts";
import type { StudioCore } from "../studio-core.ts";
import { ClaudeCodeEngine } from "../../substrate/engines/claude-code.ts";
import { CodexEngine } from "../../substrate/engines/codex.ts";
import { BonsaiEngine } from "../../substrate/engines/bonsai.ts";
import { BonsaiRuntime } from "../../substrate/bonsai/runtime.ts";
import type { DelegateResult, Engine } from "../../substrate/engines/types.ts";
import { MINUTE_MS } from "../../shared/duration.ts";
import { ReasoningEffort } from "../../shared/model-preferences.ts";

/** Why the live provider acceptance refuses to run. */
const MESSAGE = {
  liveNotAllowed: "Live provider acceptance requires explicit STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS=1.",
  cannotDelegate: (engineId: string) => `${engineId} cannot delegate`,
} as const;

/** Each live turn and the local completion get this long. */
const TURN_TIMEOUT_MS = 3 * MINUTE_MS;
/** Optional native controls have bounded deadlines independent of the model's response. */
const AFTER_TURN_MS = 1800;
/** The models each provider is asked with. */
const CLAUDE_MODEL = "claude-opus-5-5";
const CODEX_MODEL = "gpt-6-luna";
const BONSAI_MODEL = "bonsai-2:27b-pq2_0";
/** Lines of disposable context the first Codex turn carries: something worth compacting. */
const FILLER_LINES = 650;
/** Compact Now on the app server: Codex's own compaction is minutes at most. */
const COMPACT_TIMEOUT_MS = 10 * MINUTE_MS;
/** What the last Codex turn asks of the compacted session. */
const CODEX_MARKER_QUESTION = "What is the acceptance marker? Reply only the marker. No tools.";

type EngineEvent = { type: string; payload: unknown };
type Turn = { result: DelegateResult; events: EngineEvent[] };

/** One acceptance: its workspace, its report and the checks it records. */
interface Acceptance {
  cwd: string;
  report: Record<string, unknown>;
  check(name: string, ok: boolean): void;
}

export async function runProviderAcceptance(core: StudioCore, root: string): Promise<number> {
  if (process.env.STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS !== "1") throw new Error(MESSAGE.liveNotAllowed);
  await mkdir(root, { recursive: true });
  const cwd = path.join(root, "packaged-context-workspace");
  await mkdir(cwd, { recursive: true });
  const checks: Array<{ name: string; ok: boolean }> = [];
  const report: Record<string, unknown> = {
    packaged: app.isPackaged,
    electron: process.versions.electron,
    executable: process.execPath,
    mainSha256: createHash("sha256")
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest("hex"),
    profile: core.layout.engineHomes,
    checks,
  };
  const acceptance: Acceptance = {
    cwd,
    report,
    check: (name, ok) => {
      checks.push({ name, ok });
      console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
    },
  };
  try {
    await acceptClaude(acceptance, core);
    await acceptCodex(acceptance, core);
    await acceptBonsai(acceptance, root);
  } catch (error) {
    report.error = String(error);
    acceptance.check("acceptance completes without error", false);
  }
  await writeFile(path.join(root, "packaged-provider-report.json"), JSON.stringify(report, null, 2));
  return checks.some((c) => !c.ok) ? 1 : 0;
}

/** One read-only delegated turn, and the context events it reported. */
async function turn(
  cwd: string,
  engine: Engine,
  model: string,
  prompt: string,
  options: { resume?: string; compact?: boolean } = {},
): Promise<Turn> {
  if (!engine.delegate) throw new Error(MESSAGE.cannotDelegate(engine.id));
  const events: EngineEvent[] = [];
  const result = await engine.delegate({
    cwd,
    model,
    effort: ReasoningEffort.Low,
    readOnly: true,
    timeoutMs: options.compact ? COMPACT_TIMEOUT_MS : TURN_TIMEOUT_MS,
    maxTurns: 2,
    resume: options.resume,
    prompt,
    ...(options.compact ? { compact: true } : {}),
    onEvent: (event) => {
      if (event.type.startsWith("context") || event.type === "system") events.push(event);
    },
  });
  // Optional native controls have bounded deadlines independent of the model's response.
  await sleep(AFTER_TURN_MS);
  return { result, events };
}

async function acceptClaude(acceptance: Acceptance, core: StudioCore): Promise<void> {
  const { check, report } = acceptance;
  const claude: Engine = new ClaudeCodeEngine({ engineHome: path.join(core.layout.engineHomes, "live-claude") });
  const measurement = await turn(
    acceptance.cwd,
    claude,
    CLAUDE_MODEL,
    "Reply exactly CONTEXT_OK. Do not use tools or skills.",
  );
  report.claude = measurement;
  check("Claude returns a real response", measurement.result.ok && measurement.result.summary.includes("CONTEXT_OK"));
  check(
    "Claude reports measured context",
    measurement.events.some(
      (e) => e.type === "context_usage" && Number((e.payload as { promptTokens?: number }).promptTokens) > 0,
    ),
  );
}

/**
 * A marker planted under filler, the session compacted with Codex's own compaction (Compact Now),
 * then the marker asked for back from the same session.
 */
async function acceptCodex(acceptance: Acceptance, core: StudioCore): Promise<void> {
  const { check, report } = acceptance;
  const codex = new CodexEngine({ engineHome: path.join(core.layout.engineHomes, "live-codex") });
  const planted = await turn(acceptance.cwd, codex, CODEX_MODEL, codexMarkerPrompt());
  const resume = planted.result.sessionId;
  const compacted = await turn(acceptance.cwd, codex, CODEX_MODEL, "", { resume, compact: true });
  const asked = await turn(acceptance.cwd, codex, CODEX_MODEL, CODEX_MARKER_QUESTION, { resume });
  report.codex = [planted, compacted, asked];
  check("Codex compacts the session with its own compaction", compacted.result.compacted === true);
  check("Codex compacts in place: the session keeps its id", compacted.result.sessionId === resume);
  check(
    "Codex resumes the compacted session and preserves original requirements",
    asked.result.ok && asked.result.summary.includes("PINE-4826"),
  );
}

function codexMarkerPrompt(): string {
  const filler = Array.from(
    { length: FILLER_LINES },
    (_, n) => `Record ${n}: This is disposable test context. It does not request work or actions.`,
  ).join("\n");
  return `Remember the acceptance marker PINE-4826. Reply ACK only. No tools.\n${filler}`;
}

async function acceptBonsai(acceptance: Acceptance, root: string): Promise<void> {
  const local = new BonsaiEngine({
    root: path.join(root, "packaged-bonsai"),
    runtime: new BonsaiRuntime(path.join(root, "runtime")),
  });
  try {
    const response = await local.complete({
      model: BONSAI_MODEL,
      effort: ReasoningEffort.Low,
      maxTokens: 256,
      timeoutMs: TURN_TIMEOUT_MS,
      messages: [{ role: "user", content: "Reply exactly LOCAL_OK." }],
    });
    acceptance.report.bonsai = response;
    acceptance.check(
      "Bonsai responds using the verified fresh installation",
      response.message.content.includes("LOCAL_OK"),
    );
  } finally {
    await local.dispose();
  }
}
