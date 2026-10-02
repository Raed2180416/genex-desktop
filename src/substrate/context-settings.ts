import { readFile } from "node:fs/promises";
import { atomicWriteJson, isJsonObject } from "./fsx.ts";
import { validateContextPolicy, type ContextPolicy, type ContextSettings } from "../shared/context.ts";
import { EngineId } from "../shared/providers.ts";

/** The engines whose context the studio compacts itself (every other engine's CLI owns it). */
const STUDIO_COMPACTED_ENGINES: readonly string[] = [EngineId.Bonsai, EngineId.Ollama];
/** Where the studio compacts a local engine's context when no threshold is set. */
const LOCAL_DEFAULT_COMPACTION_PERCENT = 70;
/** The longest engine, model and thread ids a settings key accepts. */
const MAX_ENGINE_CHARS = 100;
const MAX_MODEL_CHARS = 200;
const MAX_THREAD_CHARS = 100;

const MESSAGE = {
  InvalidFile: "Invalid context settings",
  Unreadable:
    "Context settings could not be read. Repair or restore the host settings file before applying a custom threshold.",
  InvalidSelection: "Invalid context selection",
  ProviderOwned:
    "The native CLI owns compaction. Custom control is unavailable until this installation has been verified to enforce it.",
  CustomUnverified: "Custom compaction is not verified for this provider installation.",
} as const;

export class ContextPreferences {
  readonly file: string;
  #tail: Promise<unknown> = Promise.resolve();
  readonly control?: (engine: string, model: string) => Promise<{ supported: boolean; reason?: string }>;
  constructor(
    file: string,
    control?: (engine: string, model: string) => Promise<{ supported: boolean; reason?: string }>,
  ) {
    this.file = file;
    this.control = control;
  }
  async #read(): Promise<Record<string, ContextPolicy>> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!isJsonObject(data)) throw new Error(MESSAGE.InvalidFile);
      return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, validateContextPolicy(value)]));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(MESSAGE.Unreadable);
    }
  }
  #key(engine: string, model: string, threadId?: string) {
    if (!engine) throw new Error(MESSAGE.InvalidSelection);
    const tooLong =
      engine.length > MAX_ENGINE_CHARS || model.length > MAX_MODEL_CHARS || (threadId?.length ?? 0) > MAX_THREAD_CHARS;
    if (tooLong) throw new Error(MESSAGE.InvalidSelection);
    return JSON.stringify([engine, model || "default", threadId ?? null]);
  }
  async get(engine: string, model: string, threadId?: string): Promise<ContextSettings> {
    const values = await this.#read(),
      specific = values[this.#key(engine, model, threadId)],
      base = values[this.#key(engine, model)];
    const local = STUDIO_COMPACTED_ENGINES.includes(engine);
    const capability = local ? { supported: true } : ((await this.control?.(engine, model)) ?? { supported: false });
    return {
      policy: specific ?? base ?? { mode: "default" },
      inherited: !!threadId && !specific,
      owner: local ? "studio" : "provider",
      configurable: capability.supported,
      ...(local
        ? { defaultPercent: LOCAL_DEFAULT_COMPACTION_PERCENT }
        : { reason: capability.reason ?? MESSAGE.ProviderOwned }),
    };
  }
  async set(engine: string, model: string, policy: unknown, threadId?: string): Promise<ContextSettings> {
    const value = policy === null ? null : validateContextPolicy(policy);
    if (value?.mode === "custom" && !(await this.get(engine, model, threadId)).configurable)
      throw new Error(MESSAGE.CustomUnverified);
    const operation = this.#tail.then(async () => {
      const values = await this.#read(),
        key = this.#key(engine, model, threadId);
      if (value === null) delete values[key];
      else values[key] = value;
      await atomicWriteJson(this.file, values);
    });
    this.#tail = operation.catch(() => {});
    await operation;
    return this.get(engine, model, threadId);
  }
}
