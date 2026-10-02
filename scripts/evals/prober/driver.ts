/**
 * The seam between the probe's phases and a browser. The phases talk to a `ProbePage`, never to
 * Playwright, so every phase replays against a fake page in a hermetic test; `playwright-driver.ts`
 * is the one real implementation. Also the page-side readers of the instrument and the typed views
 * over its untyped snapshot.
 */
import { SECOND_MS } from "../../../src/shared/duration.ts";
import type { RendererMode } from "../vocabulary.ts";
import type { CameraSample, ProbeSeries, ProbeState } from "./instrument.ts";
import type { ConsoleEntry, NetworkEntry, ShotKind } from "./types.ts";
import type { FullscreenState, NavigationRecord, PointerLockState, ProbeSnapshot } from "./verdicts.ts";

/** An uncaught error the browser reported for the page, run-clock ms. */
export interface PageError {
  atMs: number;
  message: string;
}

/** Everything the driver recorded about the page from outside it. */
export interface PageEvents {
  console: ConsoleEntry[];
  pageErrors: PageError[];
  network: NetworkEntry[];
  /** Main-frame navigations only. */
  navigations: NavigationRecord[];
  /** The HTTP status of the first main-frame document, or `null` when it never answered. */
  documentStatus: number | null;
}

/** One captured image and what photographed it. */
export interface Capture {
  png: Uint8Array;
  source: ShotKind;
}

/** What a canvas capture found. */
export const CanvasState = {
  Image: "image",
  /** The page answered and has no visible canvas. */
  NoCanvas: "no-canvas",
  /** The capture itself failed (timed out, threw, tainted canvas with no fallback). */
  Failed: "failed",
} as const;
export type CanvasState = (typeof CanvasState)[keyof typeof CanvasState];

/** A canvas capture: an image, a page with no canvas, or a failed capture. */
export type CanvasCapture =
  | { state: typeof CanvasState.Image; capture: Capture }
  | { state: typeof CanvasState.NoCanvas }
  | { state: typeof CanvasState.Failed };

/** A real mouse on the page (CDP input: trusted, viewport-bounded). Every call answers whether it settled. */
export interface ProbeMouse {
  move(x: number, y: number, steps: number): Promise<boolean>;
  down(): Promise<boolean>;
  up(): Promise<boolean>;
}

/** A page under probe. Every call is bounded by the driver; a failed call answers `null`/`false`. */
export interface ProbePage {
  /** Milliseconds since the page was opened: the run clock every frame and row uses. */
  elapsedMs(): number;
  /** The main frame's current URL. */
  url(): string;
  viewport(): { width: number; height: number };
  /** Run a self-contained page-side function (serialised by the driver) with one argument. */
  evaluate<A, R>(fn: (arg: A) => R, arg: A): Promise<R | null>;
  /** The largest visible canvas: a readback, else an element screenshot. */
  captureCanvas(): Promise<CanvasCapture>;
  /** A full-page screenshot: the canvas plus the DOM HUD. */
  screenshot(): Promise<Capture | null>;
  click(selector: string): Promise<boolean>;
  clickAt(x: number, y: number): Promise<boolean>;
  press(key: string, holdMs: number): Promise<boolean>;
  events(): PageEvents;
  /** The real mouse; absent on a driver without one (drags then go out as synthetic pointer events). */
  mouse?: ProbeMouse;
}

/** A page in a touch context; `tap` is a touchscreen tap when the driver has one. */
export interface PhonePage extends ProbePage {
  tap?(x: number, y: number): Promise<boolean>;
}

/** A launched browser the probe opens one page in. */
export interface ProbeBrowser {
  /** Open `url` with `initScript` injected before any page script runs. */
  open(url: string, initScript: string): Promise<ProbePage>;
  /** Open `url` in a 390x844 @3x touch context: the full prober's phone pass. Absent on a driver without one. */
  openPhone?(url: string, initScript: string): Promise<PhonePage>;
  close(): Promise<void>;
}

/** Launch a browser for a renderer mode. */
export type LaunchBrowser = (mode: RendererMode) => Promise<ProbeBrowser>;

/** A snapshot of the instrument, typed by what the instrument writes; any field may be missing. */
export type InstrumentSnapshot = Partial<ProbeState> & ProbeSnapshot;

/** Page-side: the instrument's snapshot, or `null` when it is not installed. */
export function readProbeSnapshotInPage(): InstrumentSnapshot | null {
  const probe = (window as unknown as { __GENEX_PROBE__?: { snapshot(): InstrumentSnapshot } }).__GENEX_PROBE__;
  return probe ? probe.snapshot() : null;
}

/** Page-side: the instrument's frame series from index `fromFrame`, or `null` when it is not installed. */
export function readProbeSeriesInPage(fromFrame: number): ProbeSeries | null {
  const probe = (window as unknown as { __GENEX_PROBE__?: { series(f: number, r: number): ProbeSeries } })
    .__GENEX_PROBE__;
  return probe ? probe.series(fromFrame, 0) : null;
}

/** The instrument's animation-frame record. */
export interface RafRecord {
  distinctFrames: number;
  firstT: number | null;
  lastT: number | null;
  intervals: number[];
}

/** The rAF record of a snapshot; zeros when absent. */
export function rafOf(snap: InstrumentSnapshot | null): RafRecord {
  const raf = snap?.raf;
  return {
    distinctFrames: raf?.distinctFrames ?? 0,
    firstT: raf?.firstT ?? null,
    lastT: raf?.lastT ?? null,
    intervals: raf?.intervals ?? [],
  };
}

/** The newest camera sample, or `null` when the camera was never read. */
export function lastCameraSample(snap: InstrumentSnapshot | null): CameraSample | null {
  const samples = snap?.camera?.samples ?? [];
  return samples.length ? samples[samples.length - 1] : null;
}

/** The pointer-lock record as the verdicts read it, plus whether a lock is held now. */
export function pointerLockOf(snap: InstrumentSnapshot | null): (PointerLockState & { locked?: boolean }) | null {
  return snap?.pointerLock ?? null;
}

/** The fullscreen record. */
export function fullscreenOf(snap: InstrumentSnapshot | null): FullscreenState {
  return snap?.fullscreen ?? null;
}

/** How many WebGL contexts the page created. */
export function webglContexts(snap: InstrumentSnapshot | null): number {
  return (snap?.canvases ?? []).filter((c) => String(c.kind).startsWith("webgl")).length;
}

/** The WebGL renderer string the page reported, or `null`. */
export function glRendererOf(snap: InstrumentSnapshot | null): string | null {
  return snap?.gl?.renderer ?? null;
}

/** Median frames per second from the page's own rAF cadence, or `null` without intervals. */
export function fpsMedian(raf: RafRecord): number | null {
  const intervals = raf.intervals.filter((i) => i > 0).sort((a, b) => a - b);
  if (!intervals.length) return null;
  return SECOND_MS / intervals[Math.floor(intervals.length / 2)];
}
