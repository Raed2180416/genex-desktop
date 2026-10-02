/**
 * A Claude Code `query` that is scripted, and nothing else about the Claude path is.
 *
 * `ClaudeCodeEngineOptions.queryFn` is injected the way `CodexEngine.execFn` is, so the
 * delegation's REAL options arrive here: the allowlist the engine built, and the studio's own
 * in-process MCP server with the handlers the studio wired into it. Each step of the plan calls
 * the named tool's actual handler, so the answer is the studio's, not a fixture's — which is
 * what makes "both engines are built from the same tool list" a comparison of two observed
 * surfaces rather than a re-typed literal.
 */

export interface ScriptedToolStep {
  tool: string;
  args?: Record<string, unknown>;
}

export interface ClaudeToolCall {
  tool: string;
  args: Record<string, unknown>;
  text: string;
  images: number;
  /** Whether the studio's answer told the model the call failed. */
  isError: boolean;
}

export interface ScriptedClaude {
  queryFn: never;
  /** The options the engine really passed — allowedTools, disallowedTools, mcpServers, cwd. */
  options: Record<string, unknown> | null;
  /** The tool names the studio's own MCP server really registered. */
  tools: string[];
  calls: ClaudeToolCall[];
  prompt: unknown;
}

interface RegisteredTool {
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>;
  /** What the SDK built from the zod shape the engine handed it — the model's real contract. */
  inputSchema?: { safeParse: (value: unknown) => { success: boolean } };
}

/** The SDK server object keeps its tools on the MCP instance; this is the only way in. */
function registeredTools(options: Record<string, unknown> | null): Record<string, RegisteredTool> {
  const servers = (options?.mcpServers ?? {}) as Record<
    string,
    { instance?: { _registeredTools?: Record<string, RegisteredTool> } }
  >;
  return servers.studio?.instance?._registeredTools ?? {};
}

/**
 * The schema one studio tool was really registered with. A tool's declared shape is the only
 * thing that decides what the model is allowed to send, so a test that cares about arguments
 * asks the registered schema rather than re-reading the declaration it passed in.
 */
export function registeredSchema(record: ScriptedClaude, tool: string): RegisteredTool["inputSchema"] {
  return registeredTools(record.options)[tool]?.inputSchema;
}

export function scriptedClaude(plan: ScriptedToolStep[]): ScriptedClaude {
  const record: ScriptedClaude = { queryFn: (() => ({})) as never, options: null, tools: [], calls: [], prompt: null };
  record.queryFn = ((params: { prompt: unknown; options?: Record<string, unknown> }) => {
    record.prompt = params.prompt;
    record.options = params.options ?? null;
    record.tools = Object.keys(registeredTools(record.options)).sort();
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", model: "scripted", tools: record.tools, session_id: "shapes-claude" };
        const tools = registeredTools(record.options);
        for (const [index, step] of plan.entries()) {
          const id = `tu_${index + 1}`;
          const args = step.args ?? {};
          yield {
            type: "assistant",
            message: { content: [{ type: "tool_use", name: `mcp__studio__${step.tool}`, id, input: args }] },
          };
          const registered = tools[step.tool];
          const result = registered
            ? await registered.handler(args, {})
            : { content: [{ type: "text", text: `unknown tool ${step.tool}` }] };
          const blocks = Array.isArray(result?.content) ? result.content : [];
          const text = blocks
            .filter((block) => block.type === "text")
            .map((block) => String(block.text ?? ""))
            .join("\n");
          record.calls.push({
            tool: step.tool,
            args,
            text,
            images: blocks.filter((block) => block.type === "image").length,
            isError: result?.isError === true,
          });
          yield {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: id,
                  is_error: result?.isError === true,
                  content: [{ type: "text", text }],
                },
              ],
            },
          };
        }
        yield { type: "assistant", message: { content: [{ type: "text", text: "Looked at the build." }] } };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Looked at the build.",
          num_turns: plan.length + 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          session_id: "shapes-claude",
        };
      },
    };
  }) as never;
  return record;
}
