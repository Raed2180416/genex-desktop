/**
 * THE DIRECTIONS PHASE: press each direction key, measure the page-side burst it produced, read the
 * engine camera's own displacement, and, when both screenshots came back from the same capture path,
 * read the pixel motion. Then one press-drag-release from the centre (the gesture a putt, a
 * slingshot or a drag-to-look camera reads), with the camera's pitch restored afterwards.
 *
 * INPUT DOES NOT DEPEND ON CAPTURE. A run whose capture died at 14.5 s once pressed none of its keys
 * because the phase skipped a key whenever its before-screenshot was missing, and the scorecard then
 * blamed the sampler for bursts that were never sent. The key goes out regardless, the burst is read
 * from the sampler regardless, the camera needs no screenshot, and only the pixel analysis (the one
 * part that needs two frames) is skipped, with a timeline line saying so.
 *
 * The phase runs on injected browser calls so its no-capture behaviour replays against a fake.
 */
import { SECOND_MS } from "../../../../src/shared/duration.ts";
import {
  downsampleFrame,
  estimateGroundFlow,
  estimateMotion,
  estimateScale,
  type FrameDiff,
  frameDiff,
  type GroundFlow,
  type MotionEstimate,
  type ScaleEstimate,
} from "../frames.ts";
import type { LoggedFrame } from "../frame-log.ts";
import type { CameraSample, ProbeSample } from "../instrument.ts";

/** Which screen axis a key is expected to move the scene along. */
export const DirectionAxis = {
  X: "x",
  Y: "y",
} as const;
export type DirectionAxis = (typeof DirectionAxis)[keyof typeof DirectionAxis];

/** The direction keys, in the order they are pressed. */
export const DIRECTION_KEYS: ReadonlyArray<{ key: string; axis: DirectionAxis }> = [
  { key: "KeyD", axis: DirectionAxis.X },
  { key: "KeyA", axis: DirectionAxis.X },
  { key: "ArrowRight", axis: DirectionAxis.X },
  { key: "ArrowLeft", axis: DirectionAxis.X },
  { key: "KeyW", axis: DirectionAxis.Y },
  { key: "KeyS", axis: DirectionAxis.Y },
  { key: "ArrowUp", axis: DirectionAxis.Y },
  { key: "ArrowDown", axis: DirectionAxis.Y },
];
/** The strafe hold, and the longer forward/back hold: travel needs time, a strafe does not. */
export const DIRECTION_HOLD_MS = 0.8 * SECOND_MS;
export const TRAVEL_HOLD_MS = 2.6 * SECOND_MS;
const TRAVEL_KEYS: ReadonlySet<string> = new Set(["KeyW", "KeyS", "ArrowUp", "ArrowDown"]);
/** The pause before each key, and after its release before the after-frame. */
export const DIRECTION_SETTLE_MS = 400;
export const DIRECTION_RELEASE_MS = 180;
/**
 * The burst window runs past the release by two sampler periods: on a slow render loop the sample
 * whose diff-interval covers the hold can land after it.
 */
export const BURST_WINDOW_TAIL_MS = 4 * SECOND_MS;
/** The pixel analysis grid. */
export const ANALYSIS_WIDTH = 320;
export const ANALYSIS_HEIGHT = 180;
/** The drag burst: a leg of this share of the viewport, down and to the right. */
export const DRAG_SHARE_X = 0.22;
export const DRAG_SHARE_Y = 0.18;
/** The drag burst's own window after its mark. */
export const DRAG_WINDOW_MS = 4 * SECOND_MS;
/** The label of the drag burst's mark and frames. */
export const DRAG_INPUT = "MouseDrag";

/** The hold for a key: forward/back get the longer one. */
export function holdFor(key: string): number {
  return TRAVEL_KEYS.has(key) ? TRAVEL_HOLD_MS : DIRECTION_HOLD_MS;
}

/** The engine-read half of a direction sample: displacement along the camera's own forward axis. */
export interface CameraTravel {
  alongForward: number;
  distance: number;
}

/** One key's pixel pair and what it showed. */
export interface DirectionSample {
  key: string;
  axis: DirectionAxis;
  camera: CameraTravel | null;
  beforeFile: string;
  afterFile: string;
  motion: MotionEstimate;
  scale: ScaleEstimate;
  ground: GroundFlow;
  heldMs: number;
  diff: FrameDiff;
}

/** What the directions phase needs from the browser. */
export interface DirectionsDeps {
  keys: ReadonlyArray<{ key: string; axis: DirectionAxis }>;
  sleep: (ms: number) => Promise<void>;
  capture: (label: string) => Promise<LoggedFrame | null>;
  /** Take a page mark; its page-clock time, or `null` when the page did not answer. */
  mark: (label: string) => Promise<number | null>;
  /** Press through the focus guard; `true` only when the key went out and settled. */
  press: (key: string, holdMs: number) => Promise<boolean>;
  pullSeries: () => Promise<unknown>;
  /** The page-side sampler series as pulled so far. */
  samples: () => readonly ProbeSample[];
  readCamera: () => Promise<CameraSample | null>;
  log: (event: string, detail?: unknown) => void;
}

/** What the directions phase observed; every count is a separate fact. */
export interface DirectionsResult {
  directions: DirectionSample[];
  /** One entry per burst whose window held at least one sampler reading. */
  burstPageDiffs: number[];
  burstScreenshotDiffs: number[];
  keysSent: number;
  /** Keys whose mark the page returned: the bursts that had a window to measure. */
  marksTaken: number;
  /** Keys whose before and after frames came from the same capture path. */
  framesCaptured: number;
  /** Keys whose two frames came from different capture paths: a crop beside a page frame reads as a zoom. */
  framesMixed: number;
  /** The camera's displacement per sent key, kept whether or not a pixel pair came back. */
  cameraTravel: Array<{ key: string; axis: DirectionAxis; camera: CameraTravel }>;
}

/** The camera's displacement between two readings, projected onto the first reading's forward axis. */
export function cameraTravel(before: CameraSample, after: CameraSample): CameraTravel {
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const dz = after.z - before.z;
  return { alongForward: dx * before.fx + dy * before.fy + dz * before.fz, distance: Math.hypot(dx, dy, dz) };
}

/** The largest diff inside `[markT, markT + windowMs]`, or `null` when no reading fell inside. */
export function burstMax(samples: readonly ProbeSample[], markT: number, windowMs: number): number | null {
  const inside = samples.filter((s) => s.t >= markT && s.t <= markT + windowMs).map((s) => s.d);
  return inside.length ? Math.max(...inside) : null;
}

/** The pixel analysis of one before/after pair. */
function analysePair(
  key: string,
  axis: DirectionAxis,
  before: LoggedFrame,
  after: LoggedFrame,
  camera: CameraTravel | null,
): DirectionSample {
  const a = downsampleFrame(before.raw, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const b = downsampleFrame(after.raw, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  return {
    key,
    axis,
    camera,
    beforeFile: before.record.file,
    afterFile: after.record.file,
    motion: estimateMotion(a, b),
    scale: estimateScale(a, b),
    ground: estimateGroundFlow(a, b),
    heldMs: holdFor(key),
    diff: frameDiff(a, b),
  };
}

/** One key: capture, mark, press, capture, read the burst and the camera, analyse the pair. */
async function oneKey(deps: DirectionsDeps, entry: { key: string; axis: DirectionAxis }, out: DirectionsResult) {
  const { key, axis } = entry;
  await deps.sleep(DIRECTION_SETTLE_MS);
  const camBefore = await deps.readCamera();
  const before = await deps.capture(`${key}-before`);
  const markT = await deps.mark(`input:${key}`);
  if (markT !== null) out.marksTaken++;
  const sent = await deps.press(key, holdFor(key));
  if (sent) out.keysSent++;
  else deps.log("key.refused", { key });
  await deps.sleep(DIRECTION_RELEASE_MS);
  const after = await deps.capture(`${key}-after`);
  // Read AFTER the after-frame on purpose: a later pull only ever sees more of the window. A key
  // that never went out has no burst: its window would measure ambient motion.
  await deps.pullSeries();
  const burst = markT !== null && sent ? burstMax(deps.samples(), markT, holdFor(key) + BURST_WINDOW_TAIL_MS) : null;
  if (burst !== null) out.burstPageDiffs.push(burst);
  const camAfter = sent ? await deps.readCamera() : null;
  const camera = camBefore && camAfter ? cameraTravel(camBefore, camAfter) : null;
  if (camera) out.cameraTravel.push({ key, axis, camera });
  if (!before || !after) {
    deps.log("frames.missing", { key, before: before !== null, after: after !== null });
    return;
  }
  if (before.record.source !== after.record.source) {
    out.framesMixed++;
    deps.log("frames.mixed", { key, before: before.record.source, after: after.record.source });
    return;
  }
  out.framesCaptured++;
  const sample = analysePair(key, axis, before, after, camera);
  out.burstScreenshotDiffs.push(sample.diff.meanAbs);
  out.directions.push(sample);
}

/** Press every direction key in order and measure each. */
export async function directionsPhase(deps: DirectionsDeps): Promise<DirectionsResult> {
  const out: DirectionsResult = {
    directions: [],
    burstPageDiffs: [],
    burstScreenshotDiffs: [],
    keysSent: 0,
    marksTaken: 0,
    framesCaptured: 0,
    framesMixed: 0,
    cameraTravel: [],
  };
  for (const entry of deps.keys) await oneKey(deps, entry, out);
  return out;
}

/** What the drag burst needs from the browser. */
export interface DragBurstDeps {
  viewport: { width: number; height: number };
  sleep: (ms: number) => Promise<void>;
  capture: (label: string) => Promise<LoggedFrame | null>;
  mark: (label: string) => Promise<number | null>;
  drag: (dx: number, dy: number) => Promise<boolean>;
  /** Put the camera back on the horizon; its outcome is the caller's to record. */
  restore: () => Promise<unknown>;
  pullSeries: () => Promise<unknown>;
  samples: () => readonly ProbeSample[];
  log: (event: string, detail?: unknown) => void;
}

/** What the drag burst observed. */
export interface DragBurstResult {
  sent: boolean;
  pageDiff: number | null;
  screenshotDiff: number | null;
  mixed: boolean;
}

/** Press, drag, release from the centre; measure its burst and its before/after frames. */
export async function dragBurst(deps: DragBurstDeps): Promise<DragBurstResult> {
  await deps.sleep(DIRECTION_SETTLE_MS);
  const before = await deps.capture("drag-before");
  const markT = await deps.mark(`input:${DRAG_INPUT}`);
  const sent = await deps.drag(
    Math.floor(deps.viewport.width * DRAG_SHARE_X),
    Math.floor(deps.viewport.height * DRAG_SHARE_Y),
  );
  await deps.sleep(DIRECTION_RELEASE_MS);
  const after = await deps.capture("drag-after");
  await deps.restore();
  await deps.pullSeries();
  const pageDiff = markT !== null && sent ? burstMax(deps.samples(), markT, DRAG_WINDOW_MS) : null;
  const mixed = before !== null && after !== null && before.record.source !== after.record.source;
  if (mixed) deps.log("frames.mixed", { key: DRAG_INPUT, before: before.record.source, after: after.record.source });
  const paired = before !== null && after !== null && !mixed;
  const screenshotDiff = paired
    ? frameDiff(
        downsampleFrame(before.raw, ANALYSIS_WIDTH, ANALYSIS_HEIGHT),
        downsampleFrame(after.raw, ANALYSIS_WIDTH, ANALYSIS_HEIGHT),
      ).meanAbs
    : null;
  return { sent, pageDiff, screenshotDiff, mixed };
}
