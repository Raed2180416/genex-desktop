/**
 * Arithmetic over the normalized `TokenUsage` (Rule 13), shared by every collector and by
 * `metrics.ts`. Reasoning tokens sit inside `output`; nothing here adds them twice.
 */
import { ZERO_TOKEN_USAGE, type TokenUsage, normalizedTokens } from "../../../src/shared/eval-lane.ts";
import type { ModelTokenUsage, Usage } from "../../../src/shared/event-log.ts";

/**
 * The app's own `Usage` (an event-log record) as the normalized shape. `input_tokens` keeps the
 * provider's meaning, so a Codex figure has its cache reads taken out (the shared
 * `normalizedTokens`, which the app's field rows use too); an unreported field is 0.
 */
export function appUsageTokens(usage: Usage, engine: string | undefined): TokenUsage {
  return normalizedTokens(usage, engine);
}

/** One row of a session's per-model totals (`Usage.by_model`, Claude's `modelUsage`) as the normalized shape. */
export function modelRowTokens(row: ModelTokenUsage): TokenUsage {
  return {
    uncachedInput: row.input_tokens,
    cacheWrite: row.cache_write_tokens,
    cacheRead: row.cache_read_tokens,
    output: row.output_tokens,
    reasoning: row.reasoning_tokens ?? 0,
  };
}

/** Sum two usages field by field. */
export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  uncachedInput: a.uncachedInput + b.uncachedInput,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
  reasoning: a.reasoning + b.reasoning,
});

/** The field-wise maximum: a message written several times keeps its largest count of each kind. */
export const maxUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  uncachedInput: Math.max(a.uncachedInput, b.uncachedInput),
  cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
  cacheRead: Math.max(a.cacheRead, b.cacheRead),
  output: Math.max(a.output, b.output),
  reasoning: Math.max(a.reasoning, b.reasoning),
});

/** The sum of many usages, zero for none. */
export const sumUsage = (usages: Iterable<TokenUsage>): TokenUsage => {
  let total: TokenUsage = { ...ZERO_TOKEN_USAGE };
  for (const usage of usages) total = addUsage(total, usage);
  return total;
};

/** What a reported total holds beyond the given usages, field by field and never below zero. */
export function residualUsage(total: TokenUsage, parts: Iterable<TokenUsage>): TokenUsage {
  const counted = sumUsage(parts);
  return {
    uncachedInput: Math.max(0, total.uncachedInput - counted.uncachedInput),
    cacheWrite: Math.max(0, total.cacheWrite - counted.cacheWrite),
    cacheRead: Math.max(0, total.cacheRead - counted.cacheRead),
    output: Math.max(0, total.output - counted.output),
    reasoning: Math.max(0, total.reasoning - counted.reasoning),
  };
}

/** The prompt a call carried: every input token, cached or not. */
export const promptTokens = (usage: TokenUsage): number => usage.uncachedInput + usage.cacheWrite + usage.cacheRead;

/** Every token a usage counts once: the prompt plus the output (reasoning is inside output). */
export const totalTokens = (usage: TokenUsage): number => promptTokens(usage) + usage.output;
