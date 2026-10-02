/** Visible-file previews: one decoder at a time, no persistent per-card WebGL contexts. */
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { assetPreviewMode } from "../../shared/asset-preview.ts";
import { SECOND_MS } from "../../shared/duration.ts";
import type { ProjectAsset } from "../../shared/game-assets.ts";
import { previewBytes } from "../asset-bytes.ts";

/** A thumbnail's size in pixels, and the largest side of an image read for one. */
const THUMB_WIDTH = 360;
const THUMB_HEIGHT = 220;
const IMAGE_THUMB_PX = 512;
/** An audio file larger than this is not decoded for a waveform; the player opens it instead. */
const AUDIO_THUMB_MAX_BYTES = 20 * 1024 * 1024;
/** How long a clip may take to decode before its thumbnail gives up. */
const DECODE_TIMEOUT_MS = 15 * SECOND_MS;
/** A waveform's bars, and how many samples each bar looks at, at most. */
const WAVE_BARS = 80;
const WAVE_SAMPLES_PER_BAR = 256;
/** A waveform's geometry: where its first bar starts, the step between bars, a bar's width and its tallest and shortest heights. */
const WAVE_LEFT_PX = 20;
const WAVE_STEP_PX = 4;
const WAVE_BAR_PX = 2;
const WAVE_HEIGHT_PX = 150;
const WAVE_MIN_BAR_PX = 2;
/** The most thumbnails kept in memory; the oldest goes first. */
const CACHE_MAX = 96;

/** What a card shows in place of a thumbnail it could not draw. */
const MESSAGE = {
  cancelled: "Preview cancelled",
  unavailable: "Preview unavailable",
  largeAudio: "Open player for this large audio file",
  audioTimedOut: "Audio preview timed out",
  videoUnavailable: "Video preview unavailable",
  videoCodec: "Video codec unavailable",
  openPreview: "Open preview to inspect this file",
} as const;

/** The modes the card can draw a thumbnail for. */
const THUMBNAIL_MODES = new Set(["image", "model", "texture", "audio", "video"]);

const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

/** The bytes of a previewed file, as the model viewer module hands them over. */
type PreviewBytes = ReturnType<typeof previewBytes>;

const dataUrl = (still: { mimeType: string; data: string }): string => `data:${still.mimeType};base64,${still.data}`;

/** A model or texture rendered once off screen, snapshotted, and its viewer thrown away. */
async function viewerSnapshot(
  project: string,
  file: string,
  companions: string[],
  signal: AbortSignal,
): Promise<string> {
  const { createAssetViewer } = await import("../asset-model-viewer.js");
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;pointer-events:none`;
    document.body.append(host);
    let viewer: ReturnType<typeof createAssetViewer> | undefined;
    let settled = false;
    const finish = (outcome: { value: string } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      viewer?.dispose();
      host.remove();
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    const abort = () => finish({ error: new Error(MESSAGE.cancelled) });
    signal.addEventListener("abort", abort, { once: true });
    try {
      viewer = createAssetViewer(host, {
        file,
        companions,
        read: (file: string) => window.studio.previewProjectAsset({ project, file }),
        onTime: () => {},
        onError: (error: unknown) => finish({ error }),
        onReady: () => {
          try {
            if (!viewer) throw new Error(MESSAGE.unavailable);
            finish({ value: viewer.snapshot() });
          } catch (error) {
            finish({ error });
          }
        },
      });
    } catch (error) {
      finish({ error });
    }
  });
}

/** The loudest sample in one slice of the clip, looking at no more than a bar's share of samples. */
function peakOf(data: Float32Array, start: number, end: number): number {
  let peak = 0;
  const stride = Math.max(1, Math.floor((end - start) / WAVE_SAMPLES_PER_BAR));
  for (let j = start; j < end; j += stride) peak = Math.max(peak, Math.abs(data[j] ?? 0));
  return peak;
}

/** A clip's first channel drawn as a waveform of bars. */
async function waveform(
  bytes: PreviewBytes,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  signal: AbortSignal,
): Promise<string> {
  if (bytes.length > AUDIO_THUMB_MAX_BYTES) throw new Error(MESSAGE.largeAudio);
  const decoder = new OfflineAudioContext(1, 1, 44100);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const audio = await Promise.race([
      decoder.decodeAudioData(bytes.buffer),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(MESSAGE.audioTimedOut)), DECODE_TIMEOUT_MS);
      }),
    ]);
    signal.throwIfAborted();
    const data = audio.getChannelData(0);
    ctx.fillStyle = "#202329";
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    ctx.fillStyle = "#afb9d0";
    for (let i = 0; i < WAVE_BARS; i++) {
      const start = Math.floor((i * data.length) / WAVE_BARS);
      const end = Math.floor(((i + 1) * data.length) / WAVE_BARS);
      const h = Math.max(WAVE_MIN_BAR_PX, peakOf(data, start, end) * WAVE_HEIGHT_PX);
      ctx.fillRect(WAVE_LEFT_PX + i * WAVE_STEP_PX, THUMB_HEIGHT / 2 - h / 2, WAVE_BAR_PX, h);
    }
    return canvas.toDataURL("image/png");
  } finally {
    clearTimeout(timer);
  }
}

/** A clip's first frame, drawn onto the thumbnail's canvas. */
function firstFrame(
  bytes: PreviewBytes,
  mimeType: string,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(canvas.toDataURL("image/png"));
    };
    const abort = () => finish(new Error(MESSAGE.cancelled));
    const timer = setTimeout(() => finish(new Error(MESSAGE.videoUnavailable)), DECODE_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    video.muted = true;
    video.preload = "auto";
    video.onloadeddata = () => {
      ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      finish();
    };
    video.onerror = () => finish(new Error(MESSAGE.videoCodec));
    video.src = url;
  });
}

/** A clip's thumbnail: its waveform for audio, its first frame for video. */
async function clipThumbnail(project: string, file: string, mode: string, signal: AbortSignal): Promise<string> {
  const result = await window.studio.previewProjectAsset({
    project,
    file,
    maxBytes: mode === "audio" ? AUDIO_THUMB_MAX_BYTES : undefined,
  });
  signal.throwIfAborted();
  const bytes = previewBytes(result.data);
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(MESSAGE.unavailable);
  if (mode === "audio") return waveform(bytes, canvas, ctx, signal);
  if (mode === "video") return firstFrame(bytes, result.mimeType, canvas, ctx, signal);
  throw new Error(MESSAGE.openPreview);
}

async function thumbnail(
  project: string,
  asset: ProjectAsset,
  companions: string[],
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const file = asset.assetRef ?? asset.file;
  const mode = assetPreviewMode(asset.file);
  if (asset.render) {
    const still = await window.studio.readRunStill(asset.render).catch(() => null);
    signal.throwIfAborted();
    if (still) return dataUrl(still);
  }
  if (mode === "image") {
    const image = await window.studio.readProjectAsset({ project, file, maxPx: IMAGE_THUMB_PX });
    signal.throwIfAborted();
    if (!image) throw new Error(MESSAGE.unavailable);
    return dataUrl(image);
  }
  if (mode === "model" || mode === "texture") return viewerSnapshot(project, file, companions, signal);
  return clipThumbnail(project, file, mode, signal);
}

/** Keep a thumbnail, forgetting the oldest once the cache is full. */
function remember(key: string, value: string): void {
  cache.set(key, value);
  if (cache.size <= CACHE_MAX) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/** A thumbnail made once the card scrolls into view, one at a time across the page, and cached by the file's identity. */
function useThumbnail(
  project: string,
  asset: ProjectAsset,
  companions: string[],
  fallback: string | null,
  supported: boolean,
) {
  const key = JSON.stringify([project, asset.assetRef ?? asset.file, asset.mtime, asset.bytes, asset.render]);
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(() => fallback ?? cache.get(key) ?? null);
  const [error, setError] = useState(false);
  const [fresh, setFresh] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the asset's identity; a new object for the same file must not restart it
  useEffect(() => {
    setSrc(fallback ?? cache.get(key) ?? null);
    setFresh(false);
    setError(false);
    if (fallback || !supported) return;
    const cached = cache.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }
    const controller = new AbortController();
    let started = false;
    const observer = new IntersectionObserver((entries) => {
      if (started || !entries.some((e) => e.isIntersecting)) return;
      started = true;
      const task = queue.catch(() => {}).then(() => thumbnail(project, asset, companions, controller.signal));
      queue = task;
      void task
        .then((value) => {
          if (controller.signal.aborted) return;
          remember(key, value);
          setFresh(true);
          setSrc(value);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [key, fallback, supported]);
  return { ref, src, error, fresh };
}

/** Where the thumbnail stands, as its `data-thumbnail-state` says it. */
function thumbnailState(src: string | null, error: boolean, supported: boolean): string {
  if (src) return "ready";
  if (error) return "unavailable";
  return supported ? "loading" : "unsupported";
}

/** What the thumbnail picture shows, for its alt text. */
const ALT_KIND: Partial<Record<ProjectAsset["kind"], string>> = { model: "3D model", audio: "Audio waveform" };

/** What stands in for a thumbnail: why there is none, that it is loading, or the file's name. */
function placeholderWords(error: boolean, supported: boolean, file: string): string | undefined {
  if (error) return MESSAGE.unavailable;
  return supported ? "Loading preview…" : file.split("/").at(-1);
}

export function AssetThumbnail({
  project,
  asset,
  companions,
  fallback,
  quiet = false,
}: {
  project: string;
  asset: ProjectAsset;
  companions: string[];
  fallback: string | null;
  quiet?: boolean;
}): JSX.Element {
  const supported = THUMBNAIL_MODES.has(assetPreviewMode(asset.file));
  const { ref, src, error, fresh } = useThumbnail(project, asset, companions, fallback, supported);
  const placeholder = quiet ? null : (
    <span className="px-2 text-center text-micro">{placeholderWords(error, supported, asset.file)}</span>
  );
  return (
    <span
      ref={ref}
      className="absolute inset-0 grid place-items-center"
      data-thumbnail-state={thumbnailState(src, error, supported)}
    >
      {src ? (
        <img
          src={src}
          alt={`${ALT_KIND[asset.kind] ?? "Asset"} preview`}
          className={`h-full w-full object-contain ${fresh ? "asset-thumbnail" : ""}`}
          draggable={false}
        />
      ) : (
        placeholder
      )}
    </span>
  );
}
