import test from "node:test";
import assert from "node:assert/strict";
import { showAfterPaint } from "../../src/main/window-ready.ts";

test("paint or fallback shows once, without showing a destroyed window", () => {
  for (const destroyed of [false, true]) {
    let ready = () => {};
    let fallback = () => {};
    let shown = 0;
    showAfterPaint(
      {
        once: (_event, callback) => {
          ready = callback;
        },
        isDestroyed: () => destroyed,
        show: () => {
          shown++;
        },
      },
      (callback) => {
        fallback = callback;
        return () => {};
      },
    );
    ready();
    fallback();
    assert.equal(shown, destroyed ? 0 : 1);
  }
});
