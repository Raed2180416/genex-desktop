import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("panel notifications accept only parent, isolate callbacks and unsubscribe", async () => {
  const listeners = new Map<string, Function>();
  const parent = { postMessage() {} };
  const context = vm.createContext({
    parent,
    window: { addEventListener: (n: string, fn: Function) => listeners.set(n, fn) },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(await readFile("src/plugin-sdk/panel.js", "utf8"), context);
  let calls = 0;
  const sdk = context.window.studioPlugin;
  sdk.onContextChanged(() => {
    throw new Error("consumer failed");
  });
  const unsubscribe = sdk.onContextChanged(() => calls++);
  listeners.get("message")!({ source: {}, data: { type: "studio-plugin-context-changed" } });
  assert.equal(calls, 0);
  listeners.get("message")!({ source: parent, data: { type: "studio-plugin-context-changed" } });
  assert.equal(calls, 1);
  unsubscribe();
  listeners.get("message")!({ source: parent, data: { type: "studio-plugin-context-changed" } });
  assert.equal(calls, 1);
});
