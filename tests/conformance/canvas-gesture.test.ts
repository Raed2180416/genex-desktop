import ceilings from "../fixtures/renderer-performance-ceilings.json" with { type: "json" };
import assert from "node:assert/strict";
import { it } from "node:test";
import * as gestures from "../../src/renderer/canvas-view.ts";

it("one hundred gesture moves paint once per frame and commit only once at rest", () => {
  let frame: (() => void) | undefined;
  let paints = 0;
  let commits = 0;
  const view = { current: { k: 1, tx: 0, ty: 0 } };
  const gesture = gestures.createCanvasGesture({
    view,
    schedule: (run) => {
      frame = run;
      return 1;
    },
    cancel: () => {
      frame = undefined;
    },
    paint: () => {
      paints++;
    },
    commit: () => {
      commits++;
    },
  });
  for (let index = 1; index <= 100; index++) gesture.move({ k: 1, tx: index, ty: index });
  assert.equal(commits, ceilings.gestureMidCommitCount);
  assert.equal(paints, 0);
  frame?.();
  assert.equal(paints, ceilings.gesturePaintsPerFrame);
  assert.equal(view.current.tx, 100);
  gesture.finish();
  assert.equal(commits, ceilings.gestureSettleCommitCount);
  gesture.finish();
  assert.equal(commits, ceilings.gestureSettleCommitCount);
  gesture.move({ k: 1, tx: 200, ty: 200 });
  gesture.dispose();
  assert.equal(frame, undefined);
  assert.equal(commits, ceilings.gestureSettleCommitCount);
});

it("StrictMode cleanup and motion call browser schedulers without rebinding their receiver", () => {
  const called: string[] = [];
  const nativeSchedule = function (this: unknown): number {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    called.push("schedule");
    return 1;
  };
  const nativeCancel = function (this: unknown): void {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    called.push("cancel");
  };
  const gesture = gestures.createCanvasGesture({
    view: { current: { k: 1, tx: 0, ty: 0 } },
    schedule: nativeSchedule,
    cancel: nativeCancel,
    paint: () => {},
    commit: () => {},
  });
  gesture.dispose();
  gesture.move({ k: 1, tx: 10, ty: 0 });
  gesture.finish();
  assert.deepEqual(called, ["cancel", "schedule", "cancel"]);
});
