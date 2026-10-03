/**
 * The stage's loader picture: a patch of halftone plasma whose dots stay inside their frame and
 * move with time.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLASMA, plasmaDots } from "../../src/renderer/panels/stage/live-loader-art.ts";

test("the plasma's dots stay in its frame and change with time", () => {
  const dots = plasmaDots(0);
  assert.ok(dots.length > 0);
  for (const dot of dots) {
    assert.ok(dot.r > 0 && dot.r <= PLASMA.step * 0.5);
    assert.ok(dot.x - dot.r >= 0 && dot.x + dot.r <= PLASMA.width);
    assert.ok(dot.y - dot.r >= 0 && dot.y + dot.r <= PLASMA.height);
  }
  assert.notDeepEqual(plasmaDots(0.5), dots);
});
