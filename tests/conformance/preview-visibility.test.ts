import assert from "node:assert/strict";
import test from "node:test";
import { previewVisibility } from "../../src/main/preview-visibility.ts";

test("modal occlusion dominates stage and observer visibility in either arrival order", () => {
  for (const initialVisible of [false, true]) {
    const applied: boolean[] = [];
    const visibility = previewVisibility((visible) => applied.push(visible));
    visibility.setVisible(initialVisible);
    visibility.setOccluded(true);
    visibility.setVisible(true);
    assert.equal(applied.at(-1), false);
    visibility.setVisible(false);
    visibility.setOccluded(false);
    assert.equal(applied.at(-1), false);
    visibility.setVisible(true);
    assert.equal(applied.at(-1), true);
    visibility.setOccluded(true);
    assert.equal(applied.at(-1), false);
    visibility.setOccluded(false);
    assert.equal(applied.at(-1), true);
  }
});
