/**
 * Where the Builds canvas looks when a node opens: centred under its card at the zoom the user
 * already had. Opening a node never zooms the canvas in.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectionView } from "../../src/renderer/panels/run-graph/use-graph-camera.ts";

const near = (actual: number, expected: number, why: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${why}: ${actual} != ${expected}`);
};

describe("opening a node", () => {
  it("keeps the canvas at its zoom and brings the node to the middle", () => {
    const size = { width: 1000, height: 800 };
    const rect = { x: 100, y: 50, w: 200, h: 100 };
    for (const k of [0.4, 0.86, 1.3]) {
      const view = selectionView(size, rect, { k, tx: 12, ty: -30 });
      assert.equal(view.k, k, "the zoom the user had");
      near(view.tx + (rect.x + rect.w / 2) * k, size.width / 2, "centred across");
      near(view.ty + (rect.y + rect.h / 2) * k, (size.height - 40) / 2, "just above the zoom pill");
    }
  });
});
