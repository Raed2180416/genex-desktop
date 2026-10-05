/**
 * The stage's loader picture: a patch of halftone plasma whose dots stay inside their frame and
 * move with time.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLASMA, plasmaDots, STATUS_PLASMA } from "../../src/renderer/panels/stage/live-loader-art.ts";

test("the plasma's dots stay in its frame and change with time, on the stage and in the status line", () => {
  for (const look of [PLASMA, STATUS_PLASMA]) {
    const dots = plasmaDots(0, look);
    assert.ok(dots.length > 0);
    for (const dot of dots) {
      assert.ok(dot.r > 0 && dot.r <= look.step * look.dotScale);
      assert.ok(dot.x - dot.r >= 0 && dot.x + dot.r <= look.width);
      assert.ok(dot.y - dot.r >= 0 && dot.y + dot.r <= look.height);
    }
    assert.notDeepEqual(plasmaDots(0.5, look), dots);
  }
});
