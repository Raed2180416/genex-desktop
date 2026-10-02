/**
 * The studio window's title bar by platform. macOS keeps its inset traffic lights, in line with the
 * headers; Windows and
 * Linux get a hidden title bar with the system's minimise, maximise and close drawn as an overlay
 * the height of the app's headers, so a frameless window never loses its controls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TITLEBAR_HEIGHT, windowChrome } from "../../src/main/window-chrome.ts";

describe("window chrome", () => {
  it("macOS keeps the inset traffic lights, centred on the headers' line, and no overlay", () => {
    const chrome = windowChrome("darwin");
    assert.equal(chrome.titleBarStyle, "hiddenInset");
    assert.ok("trafficLightPosition" in chrome, "the lights are placed, not left where AppKit puts them");
    // The lights are 14pt circles; their centre is half the header's height down.
    assert.equal(chrome.trafficLightPosition.y + 7, TITLEBAR_HEIGHT / 2);
    assert.equal(chrome.trafficLightPosition.x, 12, "as far from the left edge as AppKit's inset puts them");
    assert.ok(!("titleBarOverlay" in chrome));
  });

  for (const platform of ["win32", "linux"]) {
    it(`${platform} draws the window controls over a hidden title bar, as tall as the headers`, () => {
      const chrome = windowChrome(platform);
      assert.equal(chrome.titleBarStyle, "hidden");
      assert.ok(typeof chrome.titleBarOverlay === "object", "an overlay, not a bare flag");
      assert.equal(chrome.titleBarOverlay.height, TITLEBAR_HEIGHT);
      assert.match(chrome.titleBarOverlay.color ?? "", /^#[0-9a-f]{6}$/i);
      assert.match(chrome.titleBarOverlay.symbolColor ?? "", /^#[0-9a-f]{6}$/i);
    });
  }

  it("the overlay takes the colours it is given", () => {
    assert.deepEqual(windowChrome("linux", { color: "#fafafa", symbolColor: "#111111" }), {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#fafafa", symbolColor: "#111111", height: TITLEBAR_HEIGHT },
    });
  });
});
