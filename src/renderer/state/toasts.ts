/**
 * The toast stack. A toast leaves on its own after four seconds, or when dismissed.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { SECOND_MS } from "../../shared/duration.ts";
import { problemWords } from "../words.ts";

export const TOAST_MS = 4 * SECOND_MS;

/** How a toast reads: done, went wrong, or just so you know. */
export const ToastTone = {
  Ok: "ok",
  Error: "err",
  Info: "info",
} as const;
export type ToastTone = (typeof ToastTone)[keyof typeof ToastTone];

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

/** App's toast channel, as panels receive it. */
export type Notify = (text: string, tone?: ToastTone) => void;

/** A `.catch` handler that says what went wrong in the user's words. */
export const notifyProblem =
  (notify: Notify) =>
  (error: unknown): void =>
    notify(problemWords(error), ToastTone.Error);

export interface ToastsState {
  items: ToastItem[];
  lastId: number;
}

export function toastAdded(state: ToastsState, text: string, tone: ToastTone): ToastsState {
  const id = state.lastId + 1;
  return { items: [...state.items, { id, text, tone }], lastId: id };
}

export function toastDismissed(state: ToastsState, id: number): ToastsState {
  const items = state.items.filter((toast) => toast.id !== id);
  return items.length === state.items.length ? state : { ...state, items };
}

export interface ToastsStore extends StoreApi<ToastsState> {
  notify(text: string, tone?: ToastTone): void;
  dismiss(id: number): void;
}

export function createToastsStore(
  setTimer: (run: () => void, ms: number) => unknown = (run, ms) => globalThis.setTimeout(run, ms),
): ToastsStore {
  const store = createStore<ToastsState>()(() => ({ items: [], lastId: 0 }));
  const dismiss = (id: number): void => store.setState((state) => toastDismissed(state, id), true);
  return Object.assign(store, {
    notify(text: string, tone: ToastTone = ToastTone.Info): void {
      store.setState((state) => toastAdded(state, text, tone), true);
      const id = store.getState().lastId;
      setTimer(() => dismiss(id), TOAST_MS);
    },
    dismiss,
  });
}
