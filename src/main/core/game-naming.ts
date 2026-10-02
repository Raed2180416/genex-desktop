/**
 * A new game's name from the first thing the user asked for, so its folder is named before
 * anything is written in it: one short, tool-free completion on the model the user picked. A
 * model that cannot answer in time, or answers nothing usable, leaves the name to the request's
 * own first words; the game is never left waiting for a name.
 */
import { SECOND_MS } from "../../shared/duration.ts";
import type { GameName, GameNameRequest } from "../../shared/game-project.ts";
import { WorkClass } from "../../shared/harness-api.ts";
import type { CompleteRequest, CompleteResponse, Engine } from "../../substrate/engines/types.ts";
import { GAME_NAME_SYSTEM_PROMPT, gameNameRequest } from "./game-naming-prompts.ts";

/** The longest the model may take before the request's own words name the game. */
const NAMING_TIMEOUT_MS = 20 * SECOND_MS;
/** A name is a few words: the model gets room for them and no more. */
const NAMING_MAX_TOKENS = 64;
/** The longest name kept, in characters: a title may be 80, but a folder reads better short. */
const NAME_MAX_CHARS = 40;
/** How much of the request the model reads, in characters. */
const REQUEST_MAX_CHARS = 2_000;
/** Naming is quick work: no model should think long about it. */
const NAMING_EFFORT = "low";

/** The name of a game whose request has no words to name it by. */
export const UNTITLED_GAME = "Untitled game";

/** Wrapping a reply may come in: Markdown marks and quotation marks, at either end. */
const WRAPPING = /^[\s#>*_`"'“”‘’«»„]+|[\s*_`"'“”‘’«»„]+$/g;
/** End punctuation a title does not keep. */
const TRAILING_PUNCTUATION = /[\s.!?,;:…。！？]+$/u;
/** Characters no name keeps. */
const CONTROL = /[\x00-\x1f\x7f]/g;
/** Where a request's first sentence ends. */
const SENTENCE_END = /[.!?。！？\n]/u;

/** What naming needs from the core: its engines, its budget, and (for tests) its patience. */
export interface NamingDeps {
  engines: { get(id: string): Engine; firstReady(): Promise<Engine | null> };
  budget: { run<T extends { usage?: unknown }>(workClass: WorkClass, work: () => Promise<T>): Promise<T> };
  timeoutMs?: number;
}

/** `text` with no control characters, its spaces collapsed, cut on a word to a name's length. */
function tidy(text: string): string {
  const words = text.replace(/\s+/g, " ").replace(CONTROL, "").trim();
  if (words.length <= NAME_MAX_CHARS) return words;
  const cut = words.slice(0, NAME_MAX_CHARS + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, NAME_MAX_CHARS)).trim();
}

/** The name in a model's reply: its first line, unwrapped and tidied; null when there is none. */
export function nameFromReply(reply: string): string | null {
  const line = reply.split("\n").find((candidate) => candidate.replace(WRAPPING, "").trim()) ?? "";
  const name = tidy(line.replace(WRAPPING, "").replace(TRAILING_PUNCTUATION, "").replace(WRAPPING, ""));
  return name || null;
}

/** The name a request gives itself: its first sentence, cut to a name's length, with a capital. */
export function nameFromRequest(request: string): string {
  const sentence = request.split(SENTENCE_END).find((part) => /[\p{L}\p{N}]/u.test(part)) ?? "";
  const name = tidy(sentence).replace(TRAILING_PUNCTUATION, "");
  if (!name) return UNTITLED_GAME;
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** The engine that names the game: the one picked, else the first ready; null when none can complete. */
async function namingEngine(deps: NamingDeps, engineId: string | undefined): Promise<Engine | null> {
  try {
    const engine = engineId ? deps.engines.get(engineId) : await deps.engines.firstReady();
    return typeof engine?.complete === "function" ? engine : null;
  } catch {
    return null;
  }
}

/** The model's reply, or null when it fails or runs out of time. */
async function askForName(deps: NamingDeps, engine: Engine, request: GameNameRequest): Promise<string | null> {
  const timeoutMs = deps.timeoutMs ?? NAMING_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const ask: CompleteRequest = {
    ...(request.model ? { model: request.model } : {}),
    effort: NAMING_EFFORT,
    signal,
    timeoutMs,
    maxTokens: NAMING_MAX_TOKENS,
    systemPrompt: GAME_NAME_SYSTEM_PROMPT,
    messages: [{ role: "user", content: gameNameRequest(request.prompt.slice(0, REQUEST_MAX_CHARS)) }],
    tools: [],
  };
  const answered = deps.budget.run(WorkClass.User, () => engine.complete?.(ask) as Promise<CompleteResponse>);
  // An engine that does not honour the signal still does not hold the game back.
  const timedOut = new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null)));
  try {
    const response = await Promise.race([answered, timedOut]);
    const content = response?.message.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  } finally {
    answered.catch(() => {});
  }
}

/** A name for a game started from `request.prompt`: the model's, else the request's own words. */
export async function nameGame(deps: NamingDeps, request: GameNameRequest): Promise<GameName> {
  if (typeof request?.prompt !== "string") throw new Error("A game is named from text.");
  const engine = await namingEngine(deps, request.engine);
  const reply = engine && request.prompt.trim() ? await askForName(deps, engine, request) : null;
  return { title: (reply && nameFromReply(reply)) || nameFromRequest(request.prompt) };
}
