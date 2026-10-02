/**
 * The engines the studio can build with, as main last described them. Re-read on
 * `engines.changed`, on a sign-in, after a model finishes downloading, and when a surface asks.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { EngineDescriptor, StudioApi } from "../../shared/studio-api.ts";
import { createRefresher } from "./refresher.ts";

export interface EnginesState {
  list: EngineDescriptor[];
}

export function enginesLoaded(state: EnginesState, list: EngineDescriptor[]): EnginesState {
  return state.list === list ? state : { ...state, list };
}

export interface EnginesStore extends StoreApi<EnginesState> {
  /** Read the list again; a read that fails keeps the last list. */
  refresh(): Promise<void>;
}

export function createEnginesStore(api: Pick<StudioApi, "engines">): EnginesStore {
  const store = createStore<EnginesState>()(() => ({ list: [] }));
  const refresher = createRefresher(api.engines.bind(api), (list) =>
    store.setState((state) => enginesLoaded(state, list), true),
  );
  return Object.assign(store, { refresh: () => refresher.request() });
}
