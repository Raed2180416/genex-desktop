/**
 * The installed plugins: one copy, read by the stage toolbar and the Plugins page, refreshed on
 * `plugins.changed` and whenever the page asks. A failed read keeps the last list.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { PluginInfo } from "../../shared/plugins.ts";
import type { StudioApi } from "../../shared/studio-api.ts";
import { createRefresher } from "./refresher.ts";

export interface PluginsState {
  list: PluginInfo[];
}

export function pluginsLoaded(state: PluginsState, list: PluginInfo[]): PluginsState {
  return state.list === list ? state : { ...state, list };
}

export interface PluginsStore extends StoreApi<PluginsState> {
  refresh(): Promise<void>;
}

export function createPluginsStore(api: Pick<StudioApi, "pluginsList">): PluginsStore {
  const store = createStore<PluginsState>()(() => ({ list: [] }));
  const refresher = createRefresher(api.pluginsList.bind(api), (list) =>
    store.setState((state) => pluginsLoaded(state, list), true),
  );
  return Object.assign(store, { refresh: () => refresher.request() });
}
