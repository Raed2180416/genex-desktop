/**
 * A `codex exec` that is scripted, and nothing else about the Codex path is.
 *
 * The engine, the file bridge, the shim the contractor runs, the request/response files and the
 * studio's own handlers are all real: the only thing standing in for the subscription is the
 * CLI, injected as `execFn` exactly the way `engine-codex.test.ts` injects it. Each step of the
 * plan is run as a CHILD PROCESS of `.studio/bridge/tool.mjs` — the same command a model would
 * type — so what the bridge answers is what the shim printed, not what a test pretended it did.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { BRIDGE_DIR } from "../../src/substrate/engines/studio-bridge.ts";
import type { CodexExec } from "../../src/substrate/engines/codex.ts";

export interface ScriptedToolStep {
  tool: string;
  args?: Record<string, string | number>;
}

export interface CodexShimCall {
  /** The command line as the contractor would have typed it, and as the trace records it. */
  command: string;
  stdout: string;
  stderr: string;
  code: number;
}

export interface ScriptedCodex {
  fn: CodexExec;
  /** Every shim invocation, in order — the record the assertions read. */
  seen: CodexShimCall[];
  /** The bridge's own manifest, read from inside the delegation: the OBSERVED tool surface. */
  tools: string[];
  cwd: string | null;
  prompt: string;
}

/** `node` for a child process, even when this process is Electron. */
function nodeEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", STUDIO_TOOL_TIMEOUT_MS: "120000" };
}

function runShim(cwd: string, argv: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd, env: nodeEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", (err) => resolve({ stdout, stderr: `${stderr}${String(err)}`, code: -1 }));
    child.once("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? -1 }));
  });
}

/** `--key=value`, the flag form the shim's own help prints. */
function flagsFor(args: Record<string, string | number> = {}): string[] {
  return Object.entries(args).map(([key, value]) => `--${key}=${String(value)}`);
}

export function scriptedCodex(plan: ScriptedToolStep[]): ScriptedCodex {
  const record: ScriptedCodex = { fn: (() => ({})) as never, seen: [], tools: [], cwd: null, prompt: "" };
  record.fn = (invocation) => ({
    async *[Symbol.asyncIterator]() {
      record.cwd = invocation.cwd;
      record.prompt = invocation.prompt;
      yield { type: "thread.started", thread_id: "shapes-codex" };
      const bridge = path.join(invocation.cwd, BRIDGE_DIR);
      const manifest = await readFile(path.join(bridge, "tools.json"), "utf8").catch(() => "[]");
      record.tools = (JSON.parse(manifest) as Array<{ name: string }>).map((tool) => tool.name);
      for (const [index, step] of plan.entries()) {
        const flags = flagsFor(step.args);
        const command = `node ${BRIDGE_DIR}/tool.mjs ${step.tool}${flags.length ? ` ${flags.join(" ")}` : ""}`;
        const run = await runShim(invocation.cwd, [path.join(bridge, "tool.mjs"), step.tool, ...flags]);
        record.seen.push({ command, ...run });
        // Exactly what the CLI yields for a shell command it ran, wrapper quotes and all.
        yield {
          type: "item.completed",
          item: {
            id: `c${index + 1}`,
            type: "command_execution",
            command: `/bin/zsh -lc '${command}'`,
            exit_code: run.code,
          },
        };
      }
      yield { type: "item.completed", item: { id: "msg", type: "agent_message", text: "Looked at the build." } };
      yield { type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } };
    },
  });
  return record;
}
