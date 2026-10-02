// Include this in a prebuilt panel. No credential values or arbitrary IPC are exposed.
const waiting = new Map();
const contextListeners = new Set();
let seq = 0;
window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  if (event.data?.type === "studio-plugin-context-changed") {
    for (const listener of contextListeners) {
      try {
        listener();
      } catch {}
    }
    return;
  }
  if (event.data?.type !== "studio-plugin-result") return;
  const p = waiting.get(event.data.id);
  if (!p) return;
  waiting.delete(event.data.id);
  clearTimeout(p.timer);
  event.data.error ? p.reject(new Error(event.data.error)) : p.resolve(event.data.result);
});
window.studioPlugin = {
  onContextChanged(callback) {
    contextListeners.add(callback);
    return () => contextListeners.delete(callback);
  },
  call(method, name, args, options) {
    // A long setup action may extend its local wait; host validation, confirmations and
    // execution deadlines still apply. Timing out never means a remote job was cancelled.
    const timeoutMs = options?.timeoutMs ?? 60000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000)
      return Promise.reject(new Error("Invalid panel wait duration"));
    const id = String(++seq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error("Studio request timed out. Inspect its status before retrying."));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      parent.postMessage({ type: "studio-plugin-request", id, method, name, args }, "*");
    });
  },
};
window.addEventListener("pagehide", () => {
  for (const p of waiting.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("Panel closed"));
  }
  waiting.clear();
});
