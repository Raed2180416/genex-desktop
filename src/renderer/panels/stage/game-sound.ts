/**
 * The Live game's sound switch. The renderer remembers it; main applies it to the Live view,
 * together with what only main knows (whether the stage shows Live, whether Genex is in front),
 * and keeps agents' windows silent whatever it says. ⌥⌘M flips it from anywhere: here when the
 * studio has the keyboard, through `preview.sound.toggle` when the game has it.
 */
import { useCallback, useEffect, useState } from "react";
import { isSoundShortcut, type SoundKey } from "../../../shared/game-sound.ts";
import { UiEvent } from "../../../shared/ui-events.ts";
import { type KeyValueStorage, readText, STORAGE_KEYS, writeText } from "../../storage.ts";

/** What the remembered switch holds; anything else, or nothing, is on. */
const SoundSetting = { On: "on", Off: "off" } as const;

/** The remembered switch: on unless the user turned it off. */
export function storedGameSound(storage?: KeyValueStorage | null): boolean {
  return readText(STORAGE_KEYS.gameSound, storage) !== SoundSetting.Off;
}

export function storeGameSound(on: boolean, storage?: KeyValueStorage | null): void {
  writeText(STORAGE_KEYS.gameSound, on ? SoundSetting.On : SoundSetting.Off, storage);
}

/** A DOM key press as the shortcut rule reads it. */
export const soundKeyOf = (event: KeyboardEvent): SoundKey => ({
  code: event.code,
  meta: event.metaKey,
  control: event.ctrlKey,
  alt: event.altKey,
  shift: event.shiftKey,
});

/** The switch and its toggle. */
export function useGameSound(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(() => storedGameSound());
  const toggle = useCallback(() => setOn((was) => !was), []);
  useEffect(() => storeGameSound(on), [on]);
  useEffect(() => {
    void window.studio.previewSound({ on }).catch(() => {});
  }, [on]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat || event.defaultPrevented || !isSoundShortcut(soundKeyOf(event))) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    const stop = window.studio.onEvent((event) => {
      if (event.type === UiEvent.PreviewSoundToggle) toggle();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, [toggle]);
  return { on, toggle };
}
