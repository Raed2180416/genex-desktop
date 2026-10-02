/**
 * The frames a probe writes. Nothing is written before the first non-degenerate render (Rule 18: a
 * loading card is never evidence), every frame is stamped with its phase and the origin it was taken
 * on, and the decoded pixels are kept in memory for the exposure rows so nothing is read back.
 */
import fs from "node:fs";
import path from "node:path";
import type { FrameRef } from "../grade/types.ts";
import type { ProbePhase } from "../vocabulary.ts";
import type { Capture } from "./driver.ts";
import { decodePng, type RawFrame } from "./png.ts";
import type { FrameRecord } from "./types.ts";

/** A written frame, its reference, and its decoded pixels. */
export interface LoggedFrame {
  record: FrameRecord;
  ref: FrameRef;
  raw: RawFrame;
}

/** Where frames go (nowhere on disk when `dir` is null) and what has been captured. */
export interface FrameLog {
  dir: string | null;
  firstRenderMs: number | null;
  frames: LoggedFrame[];
}

/** A log that writes into `dir` (created if missing), or keeps frames in memory only when `dir` is null. */
export function createFrameLog(dir: string | null): FrameLog {
  if (dir) fs.mkdirSync(dir, { recursive: true });
  return { dir, firstRenderMs: null, frames: [] };
}

/** Why a frame was not written. */
export const FrameRefusal = {
  BeforeFirstRender: "before-first-render",
  Undecodable: "undecodable",
} as const;
export type FrameRefusal = (typeof FrameRefusal)[keyof typeof FrameRefusal];

/** The frame's metadata at capture time. */
export interface FrameStamp {
  phase: ProbePhase;
  label: string;
  atMs: number;
  origin: string;
}

const safeLabel = (label: string) => label.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40);

/** Write one capture; refuses before the first render and for bytes that do not decode as a PNG. */
export function writeFrame(log: FrameLog, capture: Capture, stamp: FrameStamp): LoggedFrame | FrameRefusal {
  if (log.firstRenderMs === null) return FrameRefusal.BeforeFirstRender;
  let raw: RawFrame;
  try {
    raw = decodePng(capture.png);
  } catch {
    return FrameRefusal.Undecodable;
  }
  const index = String(log.frames.length + 1).padStart(2, "0");
  const file = `${index}-${stamp.phase}-${safeLabel(stamp.label)}.png`;
  const abs = log.dir ? path.join(log.dir, file) : "";
  if (log.dir) fs.writeFileSync(abs, capture.png);
  const record: FrameRecord = {
    file,
    atMs: stamp.atMs,
    phase: stamp.phase,
    label: stamp.label,
    source: capture.source,
    width: raw.width,
    height: raw.height,
  };
  const ref: FrameRef = {
    path: abs,
    atMs: stamp.atMs,
    phase: stamp.phase,
    origin: stamp.origin,
    width: raw.width,
    height: raw.height,
  };
  const logged = { record, ref, raw };
  log.frames.push(logged);
  return logged;
}
