/** An asset opened in its own dialog: a model or texture in the 3D viewer, an image, a clip, text, or why it cannot show. */
import type { JSX, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { assetPreviewMode } from "../../shared/asset-preview.ts";
import type { ProjectAsset } from "../../shared/game-assets.ts";
import type { createAssetViewer } from "../asset-model-viewer.js";
import { previewBytes } from "../asset-bytes.ts";
import { sourceLabel } from "../assets-layout.ts";
import { DialogSurface } from "../ui/dialog.tsx";
import { ResultButton as Button } from "../ui/ResultButton.tsx";
import { hostPlatform } from "../platform.ts";
import { fileManagerWords } from "../words.ts";

/** How much of a text file the preview decodes. */
const TEXT_PREVIEW_BYTES = 256 * 1024;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
/** Image zoom: one press's step and the most it zooms in. */
const ZOOM_STEP = 0.5;
const ZOOM_MAX = 4;

type Mode = ReturnType<typeof assetPreviewMode>;
type Viewer = ReturnType<typeof createAssetViewer>;
type Clip = { name: string; duration: number };

/** A file's size in KB, or in MB from a megabyte up. */
function sizeWords(bytes: number): string {
  if (bytes < BYTES_PER_MB) return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
  return `${(bytes / BYTES_PER_KB / BYTES_PER_KB).toFixed(2)} MB`;
}

/** What a read file shows as: its text, truncated past the preview's limit, or an object URL for the media element. */
function mediaFrom(
  result: Awaited<ReturnType<typeof window.studio.previewProjectAsset>>,
  mode: Mode,
): { text: string } | { url: string } {
  const bytes = previewBytes(result.data);
  if (mode !== "text") return { url: URL.createObjectURL(new Blob([bytes], { type: result.mimeType })) };
  const truncated = bytes.length > TEXT_PREVIEW_BYTES ? "\n… Preview truncated at 256 KiB; original unchanged." : "";
  return { text: new TextDecoder().decode(bytes.subarray(0, TEXT_PREVIEW_BYTES)) + truncated };
}

/** The asset loaded for its preview: the 3D viewer for a model or texture, else its bytes as text or a media URL. */
function useAssetSource(project: string, asset: ProjectAsset, assets: ProjectAsset[], host: HTMLDivElement | null) {
  const mode = assetPreviewMode(asset.file);
  const model = mode === "model" || mode === "texture";
  const media = useRef<HTMLMediaElement | null>(null);
  const viewer = useRef<Viewer | null>(null);
  const [url, setURL] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [time, setTime] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the preview reloads for a new file or viewer host, not a new list of companions
  useEffect(() => {
    let cancelled = false;
    let objectURL: string | null = null;
    const fail = (error: unknown) => {
      if (!cancelled) setError(error instanceof Error ? error.message : String(error));
    };
    const read = (file: string) => window.studio.previewProjectAsset({ project, file });
    if (model && host) {
      void import("../asset-model-viewer.js")
        .then(({ createAssetViewer }) => {
          if (cancelled) return;
          viewer.current = createAssetViewer(host, {
            file: asset.assetRef ?? asset.file,
            read,
            companions: assets.map((a) => a.assetRef ?? a.file),
            onReady: (value: { clips: Clip[]; triangles: number }) => {
              if (cancelled) return;
              setClips(value.clips);
              setReady(true);
            },
            onError: fail,
            onTime: (value: number) => {
              if (!cancelled) setTime(value);
            },
          });
        })
        .catch(fail);
    } else if (!model && mode !== "unsupported")
      void read(asset.assetRef ?? asset.file)
        .then((result) => {
          if (cancelled) return;
          const shown = mediaFrom(result, mode);
          if ("text" in shown) {
            setText(shown.text);
            setReady(true);
            return;
          }
          objectURL = shown.url;
          setURL(objectURL);
        })
        .catch(fail);
    return () => {
      cancelled = true;
      media.current?.pause();
      media.current?.removeAttribute("src");
      media.current?.load();
      viewer.current?.dispose();
      viewer.current = null;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [project, asset.assetRef, asset.file, host]);
  return { mode, model, media, viewer, url, text, error, setError, ready, setReady, clips, time };
}

type Source = ReturnType<typeof useAssetSource>;

/** Keep the media element the dialog plays, so closing the dialog stops it. */
const keepMedia =
  (media: RefObject<HTMLMediaElement | null>) =>
  (node: HTMLMediaElement | null): void => {
    if (node) media.current = node;
  };

/** The preview itself for anything but a model: the image, the player, the text, or why it cannot show. */
function MediaBody({
  source,
  asset,
  imageZoom,
}: {
  source: Source;
  asset: ProjectAsset;
  imageZoom: number;
}): JSX.Element {
  const { mode, url, setReady, setError } = source;
  return (
    <>
      {mode === "image" && url && (
        <div className="max-h-[60vh] overflow-auto">
          <img
            src={url}
            alt={asset.file.split("/").pop()}
            onLoad={() => setReady(true)}
            onError={() => setError("This image could not be decoded. The file may be incomplete or unsupported.")}
            style={imageZoom > 1 ? { width: `${imageZoom * 100}%`, maxWidth: "none" } : undefined}
            className={imageZoom === 1 ? "mx-auto max-h-[60vh] max-w-full object-contain" : "block"}
          />
        </div>
      )}
      {mode === "audio" && url && (
        <div className="flex min-h-40 flex-col justify-center gap-4 p-6">
          <span className="text-body-sm text-ink-3">Play, seek and adjust the volume below.</span>
          <audio
            ref={keepMedia(source.media)}
            controls
            preload="metadata"
            src={url}
            className="w-full"
            onLoadedMetadata={() => setReady(true)}
            onError={() => setError("This audio codec could not be played. Try a WAV, MP3 or Ogg export.")}
          />
        </div>
      )}
      {mode === "video" && url && (
        <video
          ref={keepMedia(source.media)}
          controls
          playsInline
          preload="metadata"
          src={url}
          className="mx-auto max-h-[60vh] w-full"
          onLoadedMetadata={() => setReady(true)}
          onError={() => setError("This video codec could not be played. Try an MP4 (H.264) or WebM export.")}
        />
      )}
      {mode === "text" && (
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words p-4 text-xs select-text">
          {source.text}
        </pre>
      )}
      {mode === "unsupported" && (
        <p className="p-6 text-body-sm text-ink-2">
          This format needs its authoring app. For a 3D preview with materials and animation, export GLB; for a sprite
          animation, export animated GIF/WebP or video.
        </p>
      )}
    </>
  );
}

/** The viewer's own controls over the model: reset the view, reveal the file, and how to move around. */
function ViewerControls({ source, onReveal }: { source: Source; onReveal: () => void }): JSX.Element {
  const shown = source.ready && !source.error;
  return (
    <div className="asset-viewer-controls absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
      <div className="flex gap-2">
        {shown && <Button onClick={() => source.viewer.current?.fit()}>Reset view</Button>}
        <Button onClick={onReveal}>{fileManagerWords(hostPlatform()).reveal}</Button>
      </div>
      {shown && (
        <span className="max-w-64 text-right text-micro text-white/65">
          {source.mode === "texture" ? "Scroll to zoom" : "Drag to orbit · Scroll to zoom · Right-drag to pan"}
        </span>
      )}
    </div>
  );
}

function ImageZoom({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <Button aria-label="Zoom out of image" disabled={zoom <= 1} onClick={() => onZoom(Math.max(1, zoom - ZOOM_STEP))}>
        −
      </Button>
      <span className="text-micro tabular-nums">{zoom * 100}%</span>
      <Button
        aria-label="Zoom into image"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}
      >
        +
      </Button>
      <Button variant="ghost" onClick={() => onZoom(1)}>
        Fit image
      </Button>
    </div>
  );
}

/** A model's animation clips: pick one, play or pause it, change its speed, and scrub it. */
function ClipControls({ source }: { source: Source }): JSX.Element {
  const { clips, time, viewer } = source;
  const [clip, setClip] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const duration = clip >= 0 ? (clips[clip]?.duration ?? 0) : 0;
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <label className="text-body-sm">
        Animation{" "}
        <select
          aria-label="Animation clip"
          className="cursor-pointer rounded-control bg-inset p-2"
          value={clip}
          onChange={(event) => {
            const next = Number(event.target.value);
            setClip(next);
            setPlaying(false);
            viewer.current?.clip(next);
          }}
        >
          <option value={-1}>Rest pose</option>
          {clips.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a clip is chosen by its index; names may repeat
            <option key={index} value={index}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={clip < 0}
        onClick={() => {
          viewer.current?.play(!playing);
          setPlaying(!playing);
        }}
      >
        {playing ? "Pause animation" : "Play animation"}
      </Button>
      <label className="text-body-sm">
        Speed{" "}
        <select
          aria-label="Animation speed"
          className="cursor-pointer rounded-control bg-inset p-2"
          defaultValue="1"
          onChange={(event) => viewer.current?.speed(Number(event.target.value))}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
        </select>
      </label>
      <input
        aria-label="Animation position"
        type="range"
        min="0"
        max={duration}
        step="0.01"
        value={Math.min(time, duration)}
        disabled={clip < 0}
        onChange={(event) => {
          setPlaying(false);
          viewer.current?.play(false);
          viewer.current?.seek(Number(event.target.value));
        }}
        className="min-w-32 flex-1"
      />
      <span className="text-micro tabular-nums text-ink-3">
        {time.toFixed(1)} / {duration.toFixed(1)}s · loops
      </span>
    </div>
  );
}

export function AssetPreview({
  project,
  asset,
  assets,
  onClose,
  onReveal,
}: {
  project: string;
  asset: ProjectAsset;
  assets: ProjectAsset[];
  onClose: () => void;
  onReveal: () => void;
}): JSX.Element {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const source = useAssetSource(project, asset, assets, host);
  const { mode, model, ready, error } = source;
  const shown = ready && !error;
  const loading = !ready && !error && mode !== "unsupported";
  const hasClips = mode === "model" && shown && source.clips.length > 0;
  return (
    <DialogSurface
      title={asset.file.split("/").pop() ?? "Asset preview"}
      description={`${sourceLabel(asset.source)} · ${sizeWords(asset.bytes)}`}
      onDismiss={onClose}
      headerHidden={model}
      size="2xl"
      className={model ? "asset-viewer-dialog !max-w-[960px] !p-0 !gap-0" : "!max-w-[960px]"}
      testId="asset-preview"
    >
      <div
        className={`relative min-h-40 overflow-hidden bg-inset ${model ? "rounded-2xl" : "rounded-xl"}`}
        data-asset-preview-mode={mode}
        data-preview-ready={ready}
      >
        {model && <div ref={setHost} className="h-[min(72vh,720px)] min-h-48 w-full" />}
        <MediaBody source={source} asset={asset} imageZoom={imageZoom} />
        {loading && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 grid place-items-center bg-inset/80 text-body-sm text-ink-3"
          >
            Loading preview…
          </div>
        )}
        {error && (
          <div role="alert" className="absolute inset-0 grid place-items-center bg-inset p-6 text-body-sm text-ink-2">
            {error}
          </div>
        )}
        {model && <ViewerControls source={source} onReveal={onReveal} />}
      </div>
      {mode === "image" && shown && <ImageZoom zoom={imageZoom} onZoom={setImageZoom} />}
      {hasClips && <ClipControls source={source} />}
      {!model && (
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-micro text-ink-3" title={asset.file}>
            {asset.file}
          </span>
          <Button variant="ghost" onClick={onReveal}>
            {fileManagerWords(hostPlatform()).reveal}
          </Button>
        </div>
      )}
    </DialogSurface>
  );
}
