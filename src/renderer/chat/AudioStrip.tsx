/** A delivered sound as one quiet row: play in place, see its shape, open it in Assets. */
import { type RefObject, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { MINUTE_MS, SECOND_MS } from "../../shared/duration.ts";
import type { ProjectAsset } from "../../shared/game-assets.ts";
import { previewBytes } from "../asset-bytes.ts";
import { audioPlayer, type OpenedAudio } from "./audio-player.ts";
import { ResultButton } from "../ui/ResultButton.tsx";
import { useAsyncEffect } from "../use-async-effect.ts";

const BARS = 32;
/** How many sounds' waveforms stay in memory before the oldest is forgotten. */
const WAVE_CACHE_CAP = 96;
/** A file larger than this plays without a waveform: decoding it would cost more than it shows. */
const MAX_WAVEFORM_BYTES = 20 * 1024 * 1024;
/** How many samples each bar looks at, at most, to find its peak. */
const SAMPLES_PER_BAR = 256;
/** A minute, in the seconds the player's clock counts. */
const SECONDS_PER_MINUTE = MINUTE_MS / SECOND_MS;

/** What the strip says in place of a waveform it would not draw. */
const MESSAGE = {
  tooLarge: "Large audio plays without a waveform",
} as const;

type Wave = { peaks: number[]; duration: number };
const waves = new Map<string, Wave | null>();
let queue: Promise<unknown> = Promise.resolve();

/** `referee-whistle-one-sharp-st-cmucttyj.mp3` → `Referee whistle one sharp st`. */
export function audioTitle(file: string): string {
  const base = file.split("/").at(-1) ?? file;
  let name = base.replace(/\.[a-z0-9]{1,5}$/i, "");
  // Genex names its output `<prompt slug>-<8-character id>` inside the job's own folder.
  if (/(^|\/)assets\/genex\/[0-9a-f-]{8,}\//i.test(file)) name = name.replace(/-[a-z0-9]{8}$/i, "");
  name = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : base;
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${String(whole % SECONDS_PER_MINUTE).padStart(2, "0")}`;
};

async function decode(project: string, file: string): Promise<{ peaks: number[]; duration: number }> {
  const result = await window.studio.previewProjectAsset({ project, file });
  const bytes = previewBytes(result.data);
  if (bytes.length > MAX_WAVEFORM_BYTES) throw new Error(MESSAGE.tooLarge);
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(bytes.buffer);
    const data = audio.getChannelData(0),
      peaks: number[] = [];
    for (let i = 0; i < BARS; i++) {
      const start = Math.floor((i * data.length) / BARS),
        end = Math.floor(((i + 1) * data.length) / BARS);
      let peak = 0;
      for (let j = start; j < end; j += Math.max(1, Math.floor((end - start) / SAMPLES_PER_BAR)))
        peak = Math.max(peak, Math.abs(data[j] ?? 0));
      peaks.push(peak);
    }
    const loudest = Math.max(...peaks, 0.001);
    return { peaks: peaks.map((peak) => peak / loudest), duration: audio.duration };
  } finally {
    await context.close();
  }
}

/** Remember a waveform (or that there is none), forgetting the oldest past the cap. */
function rememberWave(key: string, wave: Wave | null): void {
  waves.set(key, wave);
  if (waves.size <= WAVE_CACHE_CAP) return;
  const oldest = waves.keys().next().value;
  if (oldest !== undefined) waves.delete(oldest);
}

/**
 * The sound's waveform, decoded once the row nears the screen, one decode at a time across the
 * chat. `onDuration` learns the length the decode found.
 */
function useWaveform(
  key: string,
  source: { project: string; file: string },
  host: RefObject<HTMLDivElement | null>,
  onDuration: (seconds: number) => void,
): Wave | null | undefined {
  const [wave, setWave] = useState(() => waves.get(key));
  useAsyncEffect(
    (alive) => {
      if (waves.has(key)) return;
      let started = false;
      const observer = new IntersectionObserver(
        (entries) => {
          if (started || !entries.some((entry) => entry.isIntersecting)) return;
          started = true;
          observer.disconnect();
          const task = queue.catch(() => {}).then(() => (alive() ? decode(source.project, source.file) : null));
          queue = task;
          void task
            .then((value) => {
              if (!value) return;
              rememberWave(key, value);
              if (!alive()) return;
              setWave(value);
              onDuration(value.duration);
            })
            .catch(() => {
              waves.set(key, null);
              if (alive()) setWave(null);
            });
        },
        { rootMargin: "150px" },
      );
      if (host.current) observer.observe(host.current);
      return () => observer.disconnect();
    },
    [key],
  );
  return wave;
}

/** Read a sound's file into an element that plays it from memory. */
async function openAudio(source: { project: string; file: string }): Promise<OpenedAudio> {
  const result = await window.studio.previewProjectAsset(source);
  const url = URL.createObjectURL(new Blob([previewBytes(result.data)], { type: result.mimeType }));
  const element = new Audio(url);
  element.preload = "auto";
  return { element, close: () => URL.revokeObjectURL(url) };
}

/** The strip's player: made on the first play or seek, one playing at a time, released on unmount. */
function useAudioPlayer(source: { project: string; file: string }, knownDuration: number) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration);
  const [isPlaying, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [player] = useState(() =>
    audioPlayer(() => openAudio(source), {
      time: setTime,
      duration: setDuration,
      playing: setPlaying,
      failed: () => {
        setFailed(true);
        setPlaying(false);
      },
    }),
  );
  useEffect(() => () => player.release(), [player]);

  const seek = (seconds: number) => {
    setTime(seconds);
    return player.seek(seconds);
  };
  /** A length learned elsewhere (the waveform's decode) fills in only a length not yet known. */
  const learnDuration = (seconds: number) => setDuration((current) => current || seconds);
  return { time, duration, isPlaying, failed, toggle: player.toggle, seek, learnDuration };
}

export function AudioStrip({
  project,
  asset,
  onOpen,
  onOpenAssets,
}: {
  project: string;
  asset: ProjectAsset;
  onOpen: () => void;
  onOpenAssets?: () => void;
}) {
  const file = asset.assetRef ?? asset.file;
  const name = audioTitle(asset.file);
  const key = JSON.stringify([project, file, asset.mtime, asset.bytes]);
  const host = useRef<HTMLDivElement>(null);
  const source = { project, file };
  const { time, duration, isPlaying, failed, toggle, seek, learnDuration } = useAudioPlayer(
    source,
    waves.get(key)?.duration ?? 0,
  );
  const wave = useWaveform(key, source, host, learnDuration);

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const peaks = wave?.peaks ?? Array.from({ length: BARS }, () => 0.12);
  return (
    <div
      ref={host}
      data-audio-strip={asset.file}
      className="asset-row flex h-9 min-w-0 items-center gap-2 rounded-control bg-inset pr-3 pl-1"
    >
      <button
        type="button"
        aria-label={`${isPlaying ? "Pause" : "Play"} ${name}`}
        title={failed ? "This sound could not be played" : undefined}
        disabled={failed}
        onClick={() => void toggle()}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-150 hover:bg-control-hover disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none"
      >
        {isPlaying ? (
          <Pause aria-hidden size={14} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play aria-hidden size={14} fill="currentColor" strokeWidth={0} className="translate-x-px" />
        )}
      </button>
      <div className="relative flex min-w-0 flex-1 items-center">
        <button
          type="button"
          title={asset.file}
          onClick={onOpen}
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-chat-sub text-ink-2 hover:text-control-text-hover"
        >
          {name}
        </button>
        {/* Over the name's tail, so the waveform and time stay usable while it shows. */}
        {onOpenAssets && (
          <ResultButton
            data-open-assets
            onClick={onOpenAssets}
            className="asset-preview-action absolute right-0 top-1/2 -translate-y-1/2"
          >
            Open in Assets
          </ResultButton>
        )}
      </div>
      <div
        className="relative flex h-5 w-24 shrink-0 items-center gap-px rounded-sm has-[input:focus-visible]:bg-control-hover"
        aria-hidden={!duration}
      >
        {peaks.map((peak, i) => (
          <span
            key={i}
            className={`w-0.5 flex-1 rounded-full ${i / BARS < progress ? "bg-ink-2" : "bg-ink-3/45"}`}
            style={{ height: `${Math.max(12, peak * 100)}%` }}
          />
        ))}
        {duration > 0 && !failed && (
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={Math.min(time, duration)}
            aria-label={`Seek ${name}`}
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            onChange={(event) => void seek(Number(event.target.value))}
            className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-ink-3">
        {duration > 0 ? clock(isPlaying || time > 0 ? time : duration) : ""}
      </span>
    </div>
  );
}
