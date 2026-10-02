/** An engine call that failed, handed back with the engines that could take the work over. */
import { EngineError } from "../../substrate/engines/types.ts";
import type { EngineRegistry, FallbackNeeds } from "../../substrate/engines/registry.ts";

/**
 * The failure itself, with `fallbacks` set: the engines the registry would offer instead when it
 * is an `EngineError`, none for anything else.
 */
export async function withFallbacks(
  engines: EngineRegistry,
  engineId: string,
  err: unknown,
  needs: FallbackNeeds = {},
): Promise<EngineError & { fallbacks: string[] }> {
  const engineError = err as EngineError;
  const fallbacks = engineError instanceof EngineError ? await engines.fallbackFor(engineId, engineError, needs) : [];
  return Object.assign(engineError, { fallbacks });
}
