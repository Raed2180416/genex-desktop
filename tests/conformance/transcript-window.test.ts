import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOAD_AHEAD_SCREENS,
  loadsEarlier,
  rowOffsets,
  retainedViewport,
} from "../../src/renderer/chat/transcript-window.ts";

test("scrolling inside the mounted range retains the rendered viewport", () => {
  const offsets = rowOffsets(
    Array.from({ length: 50 }, (_, id) => ({ id: String(id) })),
    new Map(),
  );
  const current = { top: 1001, height: 600 };
  assert.equal(retainedViewport(offsets, current, { top: 1002, height: 600 }), current);
  assert.notEqual(retainedViewport(offsets, current, { top: 1800, height: 600 }), current);
});

test("earlier history loads while a reader scrolling up is still screens away from its top", () => {
  const screen = 800;
  const more = { hasMore: true, paging: false };
  const tall = screen * 20;
  const within = { scrollTop: screen * LOAD_AHEAD_SCREENS - 1, clientHeight: screen, scrollHeight: tall };
  const beyond = { scrollTop: screen * LOAD_AHEAD_SCREENS, clientHeight: screen, scrollHeight: tall };
  assert.equal(loadsEarlier(within, more, false), true, "within reach of the top: the next page loads ahead");
  assert.equal(loadsEarlier(beyond, more, false), false, "far from the top: nothing loads yet");
});

test("an opened chat reads its newest page and no more until the reader scrolls up", () => {
  const screen = 800;
  const more = { hasMore: true, paging: false };
  // A short first page with the reader at its bottom, within reach of its top: nothing loads.
  const short = { scrollTop: screen * 2, clientHeight: screen, scrollHeight: screen * 3 };
  assert.equal(loadsEarlier(short, more, true), false, "following the bottom loads nothing");
  // A chat too short to scroll could never be scrolled up: it fills in at once.
  const unscrollable = { scrollTop: 0, clientHeight: screen, scrollHeight: screen };
  assert.equal(loadsEarlier(unscrollable, more, true), true, "a chat that cannot scroll fills in");
});

test("earlier history does not load twice, past its start, or again after a failure", () => {
  const top = { scrollTop: 0, clientHeight: 800, scrollHeight: 8000 };
  assert.equal(loadsEarlier(top, { hasMore: false, paging: false }, false), false, "the chat's start is loaded");
  assert.equal(loadsEarlier(top, { hasMore: true, paging: true }, false), false, "a page is already on its way");
  assert.equal(
    loadsEarlier(top, { hasMore: true, paging: false, pageError: "disk" }, false),
    false,
    "a failed page waits for Try again",
  );
});
