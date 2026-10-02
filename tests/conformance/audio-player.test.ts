/**
 * A sound strip's play button: a sound fails only when it cannot be played, never because a
 * pause, another strip or the strip going away interrupted a play() that had not settled yet;
 * and a strip reads its sound once, however many presses overlap that read.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  type AudioElement,
  audioPlayer,
  listenToAudio,
  type OpenedAudio,
  type PlayerListener,
  releaseAudio,
  toggleAudio,
} from "../../src/renderer/chat/audio-player.ts";

/** The DOMException names a media element rejects play() with. */
const PlayRejection = { Abort: "AbortError", NotSupported: "NotSupportedError" } as const;

/** A play() promise not settled yet. */
type Pending = { resolve(): void; reject(error: Error): void };

/**
 * A stand-in `<audio>` that, like Chromium's, reads as playing as soon as play() is called and
 * settles the play() promise later: `start()` resolves it, `refuse()` rejects it as unsupported,
 * and a pause or load before then rejects it with an AbortError.
 */
function fakeAudio() {
  const state = { paused: true };
  let pending: Pending | null = null;
  const settle = (outcome: (play: Pending) => void) => {
    if (pending) outcome(pending);
    pending = null;
  };
  const interrupt = (message: string) => settle((play) => play.reject(new DOMException(message, PlayRejection.Abort)));
  const element: AudioElement = {
    get paused() {
      return state.paused;
    },
    duration: 1,
    currentTime: 0,
    play() {
      state.paused = false;
      element.onplay?.(new Event("play"));
      return new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
    pause() {
      if (state.paused) return;
      state.paused = true;
      element.onpause?.(new Event("pause"));
      interrupt("The play() request was interrupted by a call to pause().");
    },
    load() {
      state.paused = true;
      interrupt("The play() request was interrupted by a new load request.");
    },
    removeAttribute() {},
    ontimeupdate: null,
    onloadedmetadata: null,
    onplay: null,
    onpause: null,
    onended: null,
    onerror: null,
  };
  return {
    element,
    start: () => settle((play) => play.resolve()),
    refuse: () =>
      settle((play) =>
        play.reject(new DOMException("The element has no supported sources.", PlayRejection.NotSupported)),
      ),
  };
}

/** A strip's view of its sound: what its button reads and whether it gave up on the sound. */
function strip() {
  const seen = { playing: false, failed: false };
  const listener: PlayerListener = {
    time() {},
    duration() {},
    playing: (isPlaying) => {
      seen.playing = isPlaying;
    },
    failed: () => {
      seen.failed = true;
    },
  };
  return { seen, listener };
}

describe("pressing a sound strip's play button", () => {
  it("does not fail a sound paused before its play() settled", async () => {
    const audio = fakeAudio();
    const { seen, listener } = strip();
    listenToAudio(audio.element, listener);
    const play = toggleAudio(audio.element, listener);
    assert.equal(seen.playing, true, "the button reads Pause while play() is pending");
    await toggleAudio(audio.element, listener);
    await play;
    assert.deepEqual(seen, { playing: false, failed: false });

    const again = toggleAudio(audio.element, listener);
    audio.start();
    await again;
    assert.deepEqual(seen, { playing: true, failed: false }, "the sound still plays afterwards");
  });

  it("does not fail a sound another strip started over", async () => {
    const first = fakeAudio();
    const second = fakeAudio();
    const one = strip();
    const two = strip();
    listenToAudio(first.element, one.listener);
    listenToAudio(second.element, two.listener);
    const play = toggleAudio(first.element, one.listener);
    const other = toggleAudio(second.element, two.listener);
    second.start();
    await Promise.all([play, other]);
    assert.deepEqual(one.seen, { playing: false, failed: false });
    assert.deepEqual(two.seen, { playing: true, failed: false });
  });

  it("does not fail a sound whose strip went away mid-play", async () => {
    const audio = fakeAudio();
    const { seen, listener } = strip();
    listenToAudio(audio.element, listener);
    const play = toggleAudio(audio.element, listener);
    releaseAudio(audio.element);
    await play;
    assert.equal(seen.failed, false);
  });

  it("fails a sound whose source cannot be played", async () => {
    const audio = fakeAudio();
    const { seen, listener } = strip();
    listenToAudio(audio.element, listener);
    const play = toggleAudio(audio.element, listener);
    audio.refuse();
    await play;
    assert.equal(seen.failed, true);
  });

  it("fails a sound whose element reports a media error", () => {
    const audio = fakeAudio();
    const { seen, listener } = strip();
    listenToAudio(audio.element, listener);
    audio.element.onerror?.(new Event("error"));
    assert.equal(seen.failed, true);
  });
});

/** A strip's `open` whose reads finish when the test says: each read hands out a `fakeAudio`. */
function reads() {
  const started: Array<{ audio: ReturnType<typeof fakeAudio>; closed: boolean; finish(): void }> = [];
  const open = () =>
    new Promise<OpenedAudio>((resolve) => {
      const audio = fakeAudio();
      const read = {
        audio,
        closed: false,
        finish: () =>
          resolve({
            element: audio.element,
            close: () => {
              read.closed = true;
            },
          }),
      };
      started.push(read);
    });
  return { open, started };
}

describe("a sound strip opening its sound", () => {
  it("reads the sound once however many presses overlap the first read", async () => {
    const { open, started } = reads();
    const { seen, listener } = strip();
    const player = audioPlayer(open, listener);
    const presses = [player.toggle(), player.seek(0.5), player.toggle()];
    assert.equal(started.length, 1);
    started[0]?.finish();
    await Promise.all(presses);
    assert.equal(started[0]?.audio.element.currentTime, 0.5);
    assert.deepEqual(seen, { playing: false, failed: false }, "the second press paused the first");
  });

  it("never plays a sound whose strip went away during the read, and frees it", async () => {
    const { open, started } = reads();
    const { seen, listener } = strip();
    const player = audioPlayer(open, listener);
    const press = player.toggle();
    player.release();
    started[0]?.finish();
    await setImmediate();
    assert.equal(started[0]?.audio.element.paused, true);
    assert.equal(started[0]?.closed, true);
    await press;
    assert.deepEqual(seen, { playing: false, failed: false });
  });

  it("frees the sound with the strip and reads it again for a strip mounted anew", async () => {
    const { open, started } = reads();
    const { seen, listener } = strip();
    const player = audioPlayer(open, listener);
    const first = player.toggle();
    started[0]?.finish();
    await setImmediate();
    player.release();
    await first;
    assert.equal(started[0]?.closed, true);

    const again = player.toggle();
    started[1]?.finish();
    await setImmediate();
    started[1]?.audio.start();
    await again;
    assert.equal(started.length, 2);
    assert.deepEqual(seen, { playing: true, failed: false });
  });
});
