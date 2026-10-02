/**
 * The directions phase and `l2.directions_match_labels`, replayed with no browser. The phase tests are
 * ported from genex-demo's `prober/probe.test.ts` (the mechanisms that failed SILENTLY on a run whose
 * capture died at 14.5 s); the row tests pin the two halves: mirrored pairs cannot tell a swapped
 * scheme, so a pass needs the absolute forward test, and the first DECISIVE route wins.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoggedFrame } from "../../scripts/evals/prober/frame-log.ts";
import type { CameraSample, ProbeSample } from "../../scripts/evals/prober/instrument.ts";
import {
  BURST_WINDOW_TAIL_MS,
  DIRECTION_HOLD_MS,
  DIRECTION_KEYS,
  type DirectionSample,
  type DirectionsDeps,
  type DirectionsResult,
  directionsPhase,
  dragBurst,
  holdFor,
  TRAVEL_HOLD_MS,
} from "../../scripts/evals/prober/phases/directions.ts";
import {
  decideForward,
  directionPairs,
  directionsRow,
  ForwardSource,
  forwardCall,
} from "../../scripts/evals/prober/phases/directions-row.ts";
import { CheckResult, ProbePhase, ProbeRow } from "../../scripts/evals/vocabulary.ts";

/** A logged frame with no pixels worth decoding: the mixed-pair test never decodes it. */
function frameOf(label: string, source: "page" | "element"): LoggedFrame {
  return {
    record: { file: `${label}.png`, atMs: 1, phase: ProbePhase.Directions, label, source },
    ref: {
      path: `${label}.png`,
      atMs: 1,
      phase: ProbePhase.Directions,
      origin: "http://127.0.0.1",
      width: 1,
      height: 1,
    },
    raw: { width: 1, height: 1, data: new Uint8Array(4) },
  };
}

/**
 * A fake page: capture never returns a frame (the measured failure), marks advance a page clock, and
 * the sampler reports one reading inside every burst window: what the real run had and threw away.
 */
function fakePage(opts: {
  capture: (label: string) => Promise<LoggedFrame | null>;
  readCamera?: () => Promise<CameraSample | null>;
}) {
  const events: Array<{ event: string; detail?: unknown }> = [];
  const pressed: string[] = [];
  const marks: string[] = [];
  const samples: ProbeSample[] = [];
  let pageT = 30_000;
  const deps: DirectionsDeps = {
    keys: DIRECTION_KEYS,
    sleep: async () => {},
    capture: opts.capture,
    mark: async (label) => {
      marks.push(label);
      pageT += 1000;
      samples.push({ t: pageT + 300, m: 0.4, d: 0.05 });
      return pageT;
    },
    press: async (key) => {
      pressed.push(key);
      return true;
    },
    pullSeries: async () => {},
    samples: () => samples,
    readCamera: opts.readCamera ?? (async () => null),
    log: (event, detail) => {
      events.push({ event, detail });
    },
  };
  return { deps, events, pressed, marks };
}

describe("the directions phase", () => {
  it("THE MEASURED CASE: with ZERO captures every key is still pressed and every page-side burst recorded", async () => {
    const page = fakePage({ capture: async () => null });
    const result = await directionsPhase(page.deps);
    assert.equal(result.keysSent, 8, "every key went out");
    assert.deepEqual(
      page.pressed,
      DIRECTION_KEYS.map((k) => k.key),
    );
    assert.deepEqual(
      page.marks,
      DIRECTION_KEYS.map((k) => `input:${k.key}`),
    );
    assert.equal(result.burstPageDiffs.length, 8, "the page-side burst needs no screenshot");
    assert.equal(result.framesCaptured, 0, "and what did NOT happen is a separate fact");
    assert.equal(result.marksTaken, 8);
    assert.deepEqual(result.directions, []);
    const missing = page.events.filter((e) => e.event === "frames.missing");
    assert.equal(missing.length, 8, "each skipped analysis leaves a timeline line");
    assert.deepEqual(missing[0]?.detail, { key: "KeyD", before: false, after: false });
  });

  it("forward and back get the longer hold; strafes the short one", () => {
    assert.equal(holdFor("KeyW"), TRAVEL_HOLD_MS);
    assert.equal(holdFor("ArrowDown"), TRAVEL_HOLD_MS);
    assert.equal(holdFor("KeyD"), DIRECTION_HOLD_MS);
  });

  it("the burst window is the hold plus the tail; an empty window records no burst, never an invented zero", async () => {
    const page = fakePage({ capture: async () => null });
    const late: ProbeSample[] = [];
    const deps: DirectionsDeps = {
      ...page.deps,
      keys: [DIRECTION_KEYS[0]],
      mark: async () => {
        late.push({ t: 10_000 + DIRECTION_HOLD_MS + BURST_WINDOW_TAIL_MS, m: 0.4, d: 0.2 });
        late.push({ t: 10_000 + DIRECTION_HOLD_MS + BURST_WINDOW_TAIL_MS + 1, m: 0.4, d: 0.9 });
        return 10_000;
      },
      samples: () => late,
    };
    assert.deepEqual((await directionsPhase(deps)).burstPageDiffs, [0.2], "one ms past the window is out");
    const none = await directionsPhase({ ...deps, samples: () => [] });
    assert.deepEqual(none.burstPageDiffs, []);
    assert.equal(none.keysSent, 1);
    const unmarked = await directionsPhase({ ...deps, mark: async () => null });
    assert.equal(unmarked.keysSent, 1, "a mark the page could not take leaves the key pressed");
    assert.deepEqual(unmarked.burstPageDiffs, []);
  });

  it("a key the guard REFUSED is not counted as pressed, and its window is not measured as a response", async () => {
    const page = fakePage({ capture: async () => null });
    const refused = new Set(["KeyW", "KeyS"]);
    const result = await directionsPhase({ ...page.deps, press: async (key) => !refused.has(key) });
    assert.equal(result.keysSent, 6);
    assert.equal(result.marksTaken, 8, "the mark precedes the press");
    assert.equal(result.burstPageDiffs.length, 6, "a refused key's window would measure ambient motion");
    assert.deepEqual(
      page.events.filter((e) => e.event === "key.refused").map((e) => e.detail),
      [{ key: "KeyW" }, { key: "KeyS" }],
    );
  });

  it("a page frame beside a canvas-element crop is a MIXED pair: skipped, counted, never analysed", async () => {
    const page = fakePage({
      capture: async (label) => frameOf(label, label.endsWith("-before") ? "page" : "element"),
    });
    const result = await directionsPhase(page.deps);
    assert.equal(result.framesMixed, 8);
    assert.equal(result.framesCaptured, 0);
    assert.deepEqual(result.directions, []);
    const mixed = page.events.filter((e) => e.event === "frames.mixed");
    assert.deepEqual(mixed[0]?.detail, { key: "KeyD", before: "page", after: "element" });
  });

  it("THE CAMERA NEEDS NO SCREENSHOT: the engine displacement is read per sent key", async () => {
    let x = 0;
    const page = fakePage({
      capture: async () => null,
      // The camera faces +x; every read advances it 2 units along its forward axis.
      readCamera: async () => {
        x += 2;
        return { t: 1, x, y: 0, z: 0, fx: 1, fy: 0, fz: 0 };
      },
    });
    const result = await directionsPhase(page.deps);
    assert.equal(result.cameraTravel.length, 8);
    const w = result.cameraTravel.find((c) => c.key === "KeyW");
    assert.equal(w?.axis, "y");
    assert.equal(w?.camera.alongForward, 2);
    assert.equal(w?.camera.distance, 2);
    const refused = await directionsPhase({ ...page.deps, press: async () => false });
    assert.deepEqual(refused.cameraTravel, [], "an unsent input has no displacement to attribute");
  });
});

describe("the drag burst", () => {
  it("presses, drags down-and-right, restores the pitch and reads its own window", async () => {
    const calls: string[] = [];
    const samples: ProbeSample[] = [{ t: 5_100, m: 0.4, d: 0.07 }];
    const result = await dragBurst({
      viewport: { width: 1000, height: 500 },
      sleep: async () => {},
      capture: async () => null,
      mark: async () => 5_000,
      drag: async (dx, dy) => {
        calls.push(`drag ${dx},${dy}`);
        return true;
      },
      restore: async () => {
        calls.push("restore");
      },
      pullSeries: async () => {},
      samples: () => samples,
      log: () => {},
    });
    assert.deepEqual(calls, ["drag 220,90", "restore"], "the pitch is put back after every drag");
    assert.equal(result.pageDiff, 0.07);
    assert.equal(result.screenshotDiff, null);
  });
});

/** A direction sample with the given shift along its axis, correlating strongly. */
function sample(key: string, axis: "x" | "y", shift: number, extra: Partial<DirectionSample> = {}): DirectionSample {
  return {
    key,
    axis,
    camera: null,
    beforeFile: "",
    afterFile: "",
    motion: {
      dx: axis === "x" ? shift : 0,
      dy: axis === "y" ? shift : 0,
      dxScore: 0.9,
      dyScore: 0.9,
      dxScoreAtZero: 0,
      dyScoreAtZero: 0,
    },
    scale: { scale: 1, score: 0, agreed: false },
    ground: { dy: 0, score: 0, agreed: false },
    heldMs: 800,
    diff: { meanAbs: 0.1, changedFraction: 0.1, maxAbs: 0.2, threshold: 0.05 },
    ...extra,
  };
}

function result(directions: DirectionSample[], cameraTravel: DirectionsResult["cameraTravel"] = []): DirectionsResult {
  return {
    directions,
    burstPageDiffs: [],
    burstScreenshotDiffs: [],
    keysSent: 8,
    marksTaken: 8,
    framesCaptured: directions.length,
    framesMixed: 0,
    cameraTravel,
  };
}

const MIRRORED = [
  sample("KeyD", "x", 10),
  sample("KeyA", "x", -10),
  sample("ArrowRight", "x", 10),
  sample("ArrowLeft", "x", -10),
  sample("KeyW", "y", 8),
  sample("KeyS", "y", -8),
  sample("ArrowUp", "y", 8),
  sample("ArrowDown", "y", -8),
];

describe("l2.directions_match_labels", () => {
  it("THE SWAP: every pair mirrors and the absolute test cannot decide, so the row is unknown, never a pass", () => {
    const row = directionsRow(result(MIRRORED), null);
    assert.ok(directionPairs(MIRRORED).every((p) => p.verdict === CheckResult.Pass));
    assert.equal(row.id, ProbeRow.L2DirectionsMatchLabels);
    assert.equal(row.result, CheckResult.Unknown);
    assert.match(row.detail, /cannot|did not decide/);
  });

  it("the engine camera decides forward: W forward, S back passes; the inverse fails and says INVERTED", () => {
    const along = (key: string, alongForward: number) => ({
      key,
      axis: "y" as const,
      camera: { alongForward, distance: Math.abs(alongForward) },
    });
    const pass = directionsRow(result(MIRRORED, [along("KeyW", 8), along("KeyS", -8)]), null);
    assert.equal(pass.result, CheckResult.Pass);
    const inverted = directionsRow(result(MIRRORED, [along("KeyW", -8.5), along("KeyS", 8.8)]), null);
    assert.equal(inverted.result, CheckResult.Fail);
    assert.match(inverted.detail, /INVERTED/);
  });

  it("THE FIRST DECISIVE ROUTE WINS: a camera that cannot separate W from S does not silence the ground", () => {
    const withGround = MIRRORED.map((d) => {
      if (d.key === "KeyW") return { ...d, ground: { dy: -6, score: 0.8, agreed: true } };
      if (d.key === "KeyS") return { ...d, ground: { dy: 6, score: 0.8, agreed: true } };
      return d;
    });
    const momentum = [
      { key: "KeyW", axis: "y" as const, camera: { alongForward: 86.6, distance: 86.6 } },
      { key: "KeyS", axis: "y" as const, camera: { alongForward: 19.8, distance: 19.8 } },
    ];
    const call = forwardCall(result(withGround, momentum));
    assert.equal(call.source, ForwardSource.Ground);
    assert.equal(call.verdict, CheckResult.Fail);
  });

  it("a route that reads neither key abstains; below-floor travel on both abstains too", () => {
    assert.equal(decideForward(null, 3, ForwardSource.Camera), null);
    assert.equal(decideForward(0, 0, ForwardSource.Camera), null);
    assert.equal(decideForward(2, 2, ForwardSource.Camera)?.verdict, CheckResult.Unknown);
  });

  it("a strong pair disagreement fails and is named; no usable shift at all is unknown", () => {
    const same = MIRRORED.map((d) => (d.key === "KeyA" ? sample("KeyA", "x", 10) : d));
    const failed = directionsRow(result(same), null);
    assert.equal(failed.result, CheckResult.Fail);
    assert.match(failed.detail, /D vs A/);
    const blank = directionsRow(result([]), null);
    assert.equal(blank.result, CheckResult.Unknown);
    assert.match(blank.detail, /not evidence that the labels are wrong/);
  });
});
