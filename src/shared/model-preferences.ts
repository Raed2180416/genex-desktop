/**
 * How hard a model thinks, from least to most (the composer's effort dial). An engine offers a
 * subset (`EngineDescriptor.models[].efforts`). Persisted in thread metadata: never rename a value.
 */
export const ReasoningEffort = {
  None: "none",
  Minimal: "minimal",
  Low: "low",
  Medium: "medium",
  High: "high",
  Xhigh: "xhigh",
  Max: "max",
  Ultra: "ultra",
} as const;
export type ReasoningEffort = (typeof ReasoningEffort)[keyof typeof ReasoningEffort];

/** Request settings whose capabilities are advertised by the selected provider/model. */
export interface ModelPreferences {
  contextWindow?: number;
  fast?: boolean;
}

export interface ModelCapabilities {
  contextWindow?: number;
  /**
   * Where the provider will auto-compact on request (Claude Code), offered beside its own Auto. A
   * provider lists only points it honors; none means it compacts on its own.
   */
  contextChoices?: number[];
  supportsFast?: boolean;
}

export function supportedPreferences(value: ModelPreferences, model: ModelCapabilities): ModelPreferences {
  return {
    ...(value.contextWindow && model.contextChoices?.includes(value.contextWindow)
      ? { contextWindow: value.contextWindow }
      : {}),
    ...(model.supportsFast && typeof value.fast === "boolean" ? { fast: value.fast } : {}),
  };
}
