/** A sound strip's playback without React: one element per strip, one strip heard at a time. */

type MediaHandler = ((event: Event) => unknown) | null;

/** The DOMException name of a play() that a pause, or a new load, interrupted before it settled. */
const INTERRUPTED_PLAY = "AbortError";

/** The part of an `<audio>` element a strip drives; an `HTMLAudioElement` is one. */
export type AudioElement = {
  readonly paused: boolean;
  readonly duration: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  ontimeupdate: MediaHandler;
  onloadedmetadata: MediaHandler;
  onplay: MediaHandler;
  onpause: MediaHandler;
  onended: MediaHandler;
  onerror: MediaHandler;
};

/** What a strip's player tells the strip. */
export type PlayerListener = {
  time(seconds: number): void;
  duration(seconds: number): void;
  playing(isPlaying: boolean): void;
  /** The sound cannot be played. */
  failed(): void;
};

/** One strip plays at a time, like one player would. */
let playing: AudioElement | null = null;

/** Report an element's progress, length, play state and errors to its strip. */
export function listenToAudio(element: AudioElement, listener: PlayerListener): void {
  element.ontimeupdate = () => listener.time(element.currentTime);
  element.onloadedmetadata = () => {
    if (Number.isFinite(element.duration)) listener.duration(element.duration);
  };
  element.onplay = () => listener.playing(true);
  element.onpause = () => listener.playing(false);
  element.onended = () => {
    listener.playing(false);
    listener.time(0);
    element.currentTime = 0;
  };
  element.onerror = () => listener.failed();
}

/** Pause a playing element; otherwise play it, pausing whichever strip played before. */
export async function toggleAudio(element: AudioElement, listener: PlayerListener): Promise<void> {
  if (!element.paused) {
    element.pause();
    return;
  }
  if (playing && playing !== element) playing.pause();
  playing = element;
  try {
    await element.play();
  } catch (error) {
    // A pause, another strip or a release before play() settles rejects it; the sound is fine.
    if (!interruptedPlay(error)) listener.failed();
  }
}

function interruptedPlay(error: unknown): boolean {
  return error instanceof DOMException && error.name === INTERRUPTED_PLAY;
}

/** Stop and empty an element whose strip is going away. */
export function releaseAudio(element: AudioElement): void {
  element.pause();
  element.removeAttribute("src");
  element.load();
  if (playing === element) playing = null;
}

/** A strip's sound once opened: its element, and how to free what the element plays from. */
export type OpenedAudio = { element: AudioElement; close(): void };

/** A strip's player: its sound opens on the first play or seek and is freed with the strip. */
export type AudioPlayer = {
  toggle(): Promise<void>;
  seek(seconds: number): Promise<void>;
  release(): void;
};

/** Make a strip's player; `open` reads the sound only when someone asks to hear it. */
export function audioPlayer(open: () => Promise<OpenedAudio>, listener: PlayerListener): AudioPlayer {
  let opening: Promise<AudioElement | null> | null = null;
  let opened: OpenedAudio | null = null;
  /** Bumped by every release, so a read that finishes after one is freed instead of played. */
  let generation = 0;
  const free = (audio: OpenedAudio) => {
    releaseAudio(audio.element);
    audio.close();
  };
  /** The strip's element, read once however many presses overlap; null once the strip went away. */
  const element = (): Promise<AudioElement | null> => {
    if (opening) return opening;
    const started = generation;
    opening = open().then((audio) => {
      if (started !== generation) {
        free(audio);
        return null;
      }
      listenToAudio(audio.element, listener);
      opened = audio;
      return audio.element;
    });
    return opening;
  };
  return {
    toggle: async () => {
      try {
        const audio = await element();
        if (audio) await toggleAudio(audio, listener);
      } catch {
        listener.failed();
      }
    },
    seek: async (seconds) => {
      try {
        const audio = await element();
        if (audio) audio.currentTime = seconds;
      } catch {
        listener.failed();
      }
    },
    // StrictMode releases a strip and mounts it again, so a release leaves the player usable.
    release: () => {
      generation += 1;
      opening = null;
      if (opened) free(opened);
      opened = null;
    },
  };
}
