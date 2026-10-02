/**
 * The system file manager by its own name: "Show in Finder" on macOS, "Show in Explorer" on
 * Windows, and a plain folder on Linux, where there is no one file manager to name. The platform
 * is main's (`bootState`), which the renderer puts on the root as `data-platform`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hostPlatform } from "../../src/renderer/platform.ts";
import { fileManagerWords } from "../../src/renderer/words.ts";
import { StudioPlatform } from "../../src/shared/boot.ts";

test("each platform names its own file manager in Show, Reveal and the failure", () => {
  assert.deepEqual(fileManagerWords(StudioPlatform.Mac), {
    show: "Show in Finder",
    reveal: "Reveal in Finder",
    revealFailed: "Could not reveal this file in Finder.",
  });
  assert.deepEqual(fileManagerWords(StudioPlatform.Windows), {
    show: "Show in Explorer",
    reveal: "Show in Explorer",
    revealFailed: "Could not show this file in Explorer.",
  });
  assert.deepEqual(fileManagerWords(StudioPlatform.Linux), {
    show: "Show in folder",
    reveal: "Show in folder",
    revealFailed: "Could not show this file in its folder.",
  });
});

test("before main has said, or for a platform it does not know, the words stay the macOS ones", () => {
  assert.deepEqual(fileManagerWords(""), fileManagerWords(StudioPlatform.Mac));
  assert.deepEqual(fileManagerWords("freebsd"), fileManagerWords(StudioPlatform.Mac));
});

test("the host platform is the root's data-platform, or empty before main answers", () => {
  assert.equal(hostPlatform({ dataset: { platform: StudioPlatform.Windows } }), StudioPlatform.Windows);
  assert.equal(hostPlatform({ dataset: {} }), "");
});
