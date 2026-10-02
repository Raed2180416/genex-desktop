/**
 * A new version of the app, downloaded by main and waiting for a restart: read at each bootstrap
 * (it may have arrived before this window) and announced by `UiEvent.UpdateReady` after. The
 * sidebar offers Relaunch to update while it waits; it also installs at the next quit.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ReadyUpdate } from "../../shared/app-update.ts";

export interface UpdateState {
  /** The downloaded update, or null while there is none. */
  ready: ReadyUpdate | null;
}

export const initialUpdate = (): UpdateState => ({ ready: null });

/** Main downloaded `update`, or (null) holds none. */
export function updateDownloaded(state: UpdateState, update: ReadyUpdate | null): UpdateState {
  return { ...state, ready: update };
}

export type UpdateStore = StoreApi<UpdateState>;

export function createUpdateStore(): UpdateStore {
  return createStore<UpdateState>()(() => initialUpdate());
}
