/** Visibility is injectable so hidden-window polling can be tested without a browser. */
export interface VisibilitySource {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Node fixtures are visible; the desktop renderer follows Chromium's visibility state. */
export const browserVisibility: VisibilitySource = {
  hidden: () => typeof document !== "undefined" && document.hidden,
  subscribe(listener) {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};
