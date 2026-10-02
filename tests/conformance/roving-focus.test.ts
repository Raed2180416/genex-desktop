/** Keyboard movement along a row of options: tabs, menu rows and segmented controls share it. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRovingKey, RovingAxis, rovingTarget } from "../../src/renderer/ui/roving-focus.ts";

describe("moving along a row with the keyboard", () => {
  it("steps with the row's own arrows and wraps around", () => {
    assert.equal(rovingTarget("ArrowDown", 1, 3, RovingAxis.Vertical), 2);
    assert.equal(rovingTarget("ArrowDown", 2, 3, RovingAxis.Vertical), 0);
    assert.equal(rovingTarget("ArrowUp", 0, 3, RovingAxis.Vertical), 2);
    assert.equal(rovingTarget("ArrowRight", 2, 3, RovingAxis.Horizontal), 0);
    assert.equal(rovingTarget("ArrowLeft", 0, 3, RovingAxis.Horizontal), 2);
    assert.equal(rovingTarget("ArrowUp", 1, 3, RovingAxis.Both), 0);
    assert.equal(rovingTarget("ArrowRight", 1, 3, RovingAxis.Both), 2);
  });

  it("lands on the first row from no focused row, and jumps with Home and End", () => {
    assert.equal(rovingTarget("ArrowDown", -1, 4, RovingAxis.Vertical), 0);
    assert.equal(rovingTarget("Home", 2, 4, RovingAxis.Horizontal), 0);
    assert.equal(rovingTarget("End", 0, 4, RovingAxis.Vertical), 3);
  });

  it("ignores the other axis and every other key", () => {
    assert.equal(rovingTarget("ArrowLeft", 1, 3, RovingAxis.Vertical), null);
    assert.equal(rovingTarget("ArrowDown", 1, 3, RovingAxis.Horizontal), null);
    assert.equal(rovingTarget("Tab", 1, 3, RovingAxis.Both), null);
    assert.equal(rovingTarget("constructor", 1, 3, RovingAxis.Both), null);
    assert.equal(isRovingKey("End", RovingAxis.Horizontal), true);
    assert.equal(isRovingKey("ArrowUp", RovingAxis.Horizontal), false);
    assert.equal(isRovingKey("ArrowUp", RovingAxis.Vertical), true);
  });
});
