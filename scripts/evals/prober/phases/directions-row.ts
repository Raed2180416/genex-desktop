/**
 * `l2.directions_match_labels`, from what the directions phase observed, with no browser.
 *
 * Two halves that answer different questions. The RELATIVE pairs (D vs A, W vs S, W vs ArrowUp…)
 * catch "both keys do the same thing" and "WASD and the arrows disagree", and they are structurally
 * blind to a SWAP: forward and back exchanged still oppose each other. The ABSOLUTE test (does W go
 * forward?) is what separates a correct scheme from an inverted one, so a PASS requires it. Its
 * routes are tried in order and the first DECISIVE one wins: the engine camera's displacement along
 * its own forward axis, then the ground's flow in the side bands, then radial expansion. An engine
 * reading that cannot tell W from S (a vehicle with momentum drifts forward under both) must not
 * silence a pixel route that can.
 */
import { CheckResult, ProbeRow } from "../../vocabulary.ts";
import { MIN_SCALE_DELTA, MIN_SCALE_SCORE } from "../frames.ts";
import type { Check } from "../types.ts";
import { type DirectionPairVerdict, directionPairVerdict, PairWant } from "../verdicts.ts";
import {
  type CameraTravel,
  DirectionAxis,
  type DirectionSample,
  type DirectionsResult,
  type DragBurstResult,
} from "./directions.ts";
import { MIN_CAMERA_TRAVEL } from "./entrance.ts";
import { machineRow } from "./row.ts";

/** Cross-correlation below this: the two frames do not share enough structure to call a direction. */
export const MIN_MOTION_SCORE = 0.4;
/** Motion smaller than this (160-wide grid columns) is inside the noise. */
export const MIN_MOTION_COLUMNS = 2;
/** The ground-flow route's floors. */
export const MIN_GROUND_SCORE = 0.5;
export const MIN_GROUND_DY = 2;

/** Which route decided forward/back. */
export const ForwardSource = {
  Camera: "camera",
  Ground: "ground",
  Expansion: "expansion",
} as const;
export type ForwardSource = (typeof ForwardSource)[keyof typeof ForwardSource];

/** The absolute test's call. */
export interface ForwardCall {
  verdict: CheckResult;
  why: string;
  source: ForwardSource | null;
}

/** A named pair and its verdict. */
export type NamedPair = { name: string; a: number | null; b: number | null; want: PairWant } & DirectionPairVerdict;

/** A key's usable shift along its axis: `null` unreadable, `0` below the noise floor. */
function shiftOf(sample: DirectionSample | undefined): number | null {
  if (!sample) return null;
  const x = sample.axis === DirectionAxis.X;
  const shift = x ? sample.motion.dx : sample.motion.dy;
  const score = x ? sample.motion.dxScore : sample.motion.dyScore;
  if (score < MIN_MOTION_SCORE) return null;
  return Math.abs(shift) < MIN_MOTION_COLUMNS ? 0 : shift;
}

/** The six relative pairs and their verdicts. */
export function directionPairs(directions: readonly DirectionSample[]): NamedPair[] {
  const byKey = new Map(directions.map((d) => [d.key, d]));
  const s = (key: string) => shiftOf(byKey.get(key));
  const pairs = [
    { name: "D vs A", a: s("KeyD"), b: s("KeyA"), want: PairWant.Opposite },
    { name: "ArrowRight vs ArrowLeft", a: s("ArrowRight"), b: s("ArrowLeft"), want: PairWant.Opposite },
    { name: "D vs ArrowRight", a: s("KeyD"), b: s("ArrowRight"), want: PairWant.Same },
    { name: "W vs S", a: s("KeyW"), b: s("KeyS"), want: PairWant.Opposite },
    { name: "ArrowUp vs ArrowDown", a: s("ArrowUp"), b: s("ArrowDown"), want: PairWant.Opposite },
    { name: "W vs ArrowUp", a: s("KeyW"), b: s("ArrowUp"), want: PairWant.Same },
  ];
  return pairs.map((p) => ({ ...p, ...directionPairVerdict(p) }));
}

/** One route's forward/back call, or `null` when it could not read either key. */
export function decideForward(w: number | null, s: number | null, source: ForwardSource): ForwardCall | null {
  if (w === null || s === null) return null;
  if (w === 0 && s === 0) return null;
  if (w > 0 && s < 0) {
    return {
      verdict: CheckResult.Pass,
      why: `W moved forward and S moved back, read from the ${source} (W ${w}, S ${s})`,
      source,
    };
  }
  if (w < 0 && s > 0) {
    return {
      verdict: CheckResult.Fail,
      why: `INVERTED: W moved BACKWARD and S moved FORWARD, read from the ${source} (W ${w}, S ${s}); forward and back are swapped`,
      source,
    };
  }
  return {
    verdict: CheckResult.Unknown,
    why: `W and S moved the scene the same way in the ${source} (${w} / ${s}), so they cannot be told apart`,
    source,
  };
}

const NO_FORWARD: ForwardCall = {
  verdict: CheckResult.Unknown,
  why: "neither the engine camera, the ground nor the scene scale gave a usable signal; a top-down, static or heavily occluded camera cannot answer this",
  source: null,
};

/** The absolute test: the first decisive route of camera, ground, expansion. */
export function forwardCall(r: DirectionsResult): ForwardCall {
  const byKey = new Map(r.directions.map((d) => [d.key, d]));
  const travel = new Map(r.cameraTravel.map((c) => [c.key, c.camera]));
  const camera = (key: string): number | null => {
    const c: CameraTravel | null | undefined = byKey.get(key)?.camera ?? travel.get(key);
    if (!c) return null;
    return c.distance < MIN_CAMERA_TRAVEL ? 0 : c.alongForward;
  };
  const ground = (key: string): number | null => {
    const g = byKey.get(key)?.ground;
    // `agreed` rejects a turn, where the two side bands flow opposite ways.
    if (!g?.agreed || g.score < MIN_GROUND_SCORE) return null;
    return Math.abs(g.dy) < MIN_GROUND_DY ? 0 : g.dy;
  };
  const expansion = (key: string): number | null => {
    const sc = byKey.get(key)?.scale;
    if (!sc?.agreed || sc.score < MIN_SCALE_SCORE) return null;
    return Math.abs(sc.scale - 1) < MIN_SCALE_DELTA ? 0 : sc.scale - 1;
  };
  const routes = [
    decideForward(camera("KeyW"), camera("KeyS"), ForwardSource.Camera),
    decideForward(ground("KeyW"), ground("KeyS"), ForwardSource.Ground),
    decideForward(expansion("KeyW"), expansion("KeyS"), ForwardSource.Expansion),
  ].filter((call): call is ForwardCall => call !== null);
  return routes.find((call) => call.verdict !== CheckResult.Unknown) ?? routes[0] ?? NO_FORWARD;
}

const names = (pairs: readonly NamedPair[]) => pairs.map((p) => p.name).join(", ");

/** The sentence for an undecided row: say what the pairs saw, and that it cannot tell a swap. */
function unknownDetail(decided: readonly NamedPair[], forward: ForwardCall): string {
  if (!decided.length) {
    return "No direction pair produced a correlated shift above the noise floor: the camera may be mouse-driven, the movement too small, or the scene too changeable to correlate. This is not evidence that the labels are wrong.";
  }
  const passed = decided.filter((p) => p.verdict === CheckResult.Pass);
  return `${names(passed)} mirrored as expected, but mirrored inputs stay mirrored when forward and back are exchanged. The absolute test separates them and did not decide: ${forward.why}. Not evidence the labels are wrong; not evidence they are right.`;
}

/** `l2.directions_match_labels`: a pass needs the absolute test; a fail may come from either half, named. */
export function directionsRow(r: DirectionsResult, drag: DragBurstResult | null): Check {
  const pairs = directionPairs(r.directions);
  const forward = forwardCall(r);
  const failedPairs = pairs.filter((p) => p.verdict === CheckResult.Fail);
  const value = {
    pairs: pairs.map((p) => ({ pair: p.name, want: p.want, verdict: p.verdict, why: p.why })),
    forward,
    keysSent: r.keysSent,
    marksTaken: r.marksTaken,
    framesCaptured: r.framesCaptured,
    framesMixed: r.framesMixed,
    cameraSamples: r.cameraTravel.length,
    burstsSampled: r.burstPageDiffs.length,
    drag,
    minMotionColumns: MIN_MOTION_COLUMNS,
    minCorrelation: MIN_MOTION_SCORE,
  };
  if (failedPairs.length || forward.verdict === CheckResult.Fail) {
    const parts = [
      forward.verdict === CheckResult.Fail ? forward.why : "",
      failedPairs.map((p) => `${p.name} (${p.why})`).join("; "),
    ].filter(Boolean);
    return machineRow(ProbeRow.L2DirectionsMatchLabels, CheckResult.Fail, parts.join(" · "), value);
  }
  if (forward.verdict === CheckResult.Pass) {
    const passed = pairs.filter((p) => p.verdict === CheckResult.Pass);
    const mirrored = passed.length ? `${names(passed)} mirrored as expected. ` : "";
    return machineRow(
      ProbeRow.L2DirectionsMatchLabels,
      CheckResult.Pass,
      `${mirrored}Forward/back: ${forward.why}.`,
      value,
    );
  }
  const decided = pairs.filter((p) => p.verdict !== CheckResult.Unknown);
  return machineRow(ProbeRow.L2DirectionsMatchLabels, CheckResult.Unknown, unknownDetail(decided, forward), value);
}
