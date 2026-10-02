/** The surface words a computer tool speaks: what the model asks for and what it is told it got. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodedJpeg, requestedSurface, surfaceWord } from "../../src/main/core/capture.ts";

describe("capture surface words", () => {
  it("names the page a screen, the canvas a canvas, and nothing else at all", () => {
    assert.equal(surfaceWord("page"), "screen");
    assert.equal(surfaceWord("canvas"), "canvas");
    assert.equal(surfaceWord("auto"), null);
    assert.equal(surfaceWord(null), null);
    assert.equal(surfaceWord("toString" as never), null);
  });

  it("reads a request's surface, letting the studio pick when none or an unknown one is named", () => {
    assert.equal(requestedSurface({ surface: "screen" }), "page");
    assert.equal(requestedSurface({ surface: "canvas" }), "canvas");
    assert.equal(requestedSurface({}), "auto");
    assert.equal(requestedSurface({ surface: "desk" as never }), "auto");
    assert.equal(requestedSurface({ surface: "constructor" as never }), "auto");
  });

  it("answers an encoded still as its path, base64 and byte count", () => {
    assert.deepEqual(encodedJpeg(Buffer.from("jpeg"), "/runs/a/shot.jpg"), {
      path: "/runs/a/shot.jpg",
      base64: Buffer.from("jpeg").toString("base64"),
      bytes: 4,
    });
  });
});
