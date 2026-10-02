/**
 * Which subscription models the model picker lists, as the person set them in Settings: per
 * engine, per model, shown or not. Only a choice that differs from the rule (model-lineup.ts) is
 * kept, so a model released later still follows the rule. Kept in `localStorage` for this profile.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PickerChoices } from "../model-choices.ts";
import { browserStorage, readJson, STORAGE_KEYS, writeJson, type KeyValueStorage } from "../storage.ts";

export interface ModelPickerState {
  choices: PickerChoices;
}

/** One model shown or hidden; a choice equal to the rule's is forgotten instead of kept. */
export function pickerModelSet(
  state: ModelPickerState,
  change: { engine: string; model: string; shown: boolean; byDefault: boolean },
): ModelPickerState {
  const { [change.model]: _previous, ...rest } = state.choices[change.engine] ?? {};
  const engine = change.shown === change.byDefault ? rest : { ...rest, [change.model]: change.shown };
  const { [change.engine]: _engine, ...others } = state.choices;
  return { ...state, choices: Object.keys(engine).length ? { ...others, [change.engine]: engine } : others };
}

/** Back to the rule for one engine. */
export function pickerModelsReset(state: ModelPickerState, engine: string): ModelPickerState {
  if (!state.choices[engine]) return state;
  const { [engine]: _engine, ...others } = state.choices;
  return { ...state, choices: others };
}

/** The stored choices, keeping only engine → model → boolean entries. */
function readChoices(storage: KeyValueStorage | null): PickerChoices {
  const raw = readJson<unknown>(STORAGE_KEYS.pickerModels, {}, storage);
  if (!raw || typeof raw !== "object") return {};
  const engines = Object.entries(raw).map(([engine, models]) => {
    const entries: Array<[string, unknown]> = models && typeof models === "object" ? Object.entries(models) : [];
    const kept = entries.flatMap(([model, shown]) => (typeof shown === "boolean" ? [[model, shown] as const] : []));
    return [engine, Object.fromEntries(kept)] as const;
  });
  return Object.fromEntries(engines.filter(([, models]) => Object.keys(models).length > 0));
}

export type ModelPickerStore = StoreApi<ModelPickerState>;

export function createModelPickerStore(storage: KeyValueStorage | null = browserStorage()): ModelPickerStore {
  const store = createStore<ModelPickerState>()(() => ({ choices: readChoices(storage) }));
  store.subscribe((state, previous) => {
    if (state.choices !== previous.choices) writeJson(STORAGE_KEYS.pickerModels, state.choices, storage);
  });
  return store;
}
