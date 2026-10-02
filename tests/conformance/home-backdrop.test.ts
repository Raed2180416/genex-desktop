/**
 * Home's background: saved settings read back inside their ranges, and the picture turned into ink
 * the same way on both themes, so an effect draws the picture rather than its negative.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  colorLightness,
  coverageAt,
  coverageField,
  coverCrop,
  grainAt,
  rampCharacter,
  thresholded,
} from "../../src/renderer/home-backdrop/field.ts";
import { homeView, previewView } from "../../src/renderer/home-backdrop/view.ts";
import {
  BACKDROP_RANGES,
  BackdropEffect,
  backdropDecimals,
  DEFAULT_BACKDROP,
  DotGrid,
  normalizeBackdrop,
} from "../../src/renderer/home-backdrop/settings.ts";

const FLAT = { grain: 0, gamma: 1, blackPoint: 0, whitePoint: 255 };
/** RGBA for grey levels. */
const greys = (...levels: number[]): Uint8ClampedArray =>
  Uint8ClampedArray.from(levels.flatMap((level) => [level, level, level, 255]));

describe("home background settings read back", () => {
  it("nothing saved, or something unreadable, is the default", () => {
    for (const saved of [null, undefined, 42, "dots", []]) assert.deepEqual(normalizeBackdrop(saved), DEFAULT_BACKDROP);
  });

  it("keeps what it can use and defaults the rest", () => {
    const settings = normalizeBackdrop({
      effect: BackdropEffect.Ascii,
      image: "upload:3f1c-aa",
      dotGrid: DotGrid.Benday,
      asciiColumns: 90,
      strength: "loud",
    });
    assert.equal(settings.effect, BackdropEffect.Ascii);
    assert.equal(settings.image, "upload:3f1c-aa");
    assert.equal(settings.dotGrid, DotGrid.Benday);
    assert.equal(settings.asciiColumns, 90);
    assert.equal(settings.strength, DEFAULT_BACKDROP.strength);
  });

  const hostile: Array<[string, Record<string, unknown>, Partial<typeof DEFAULT_BACKDROP>]> = [
    ["an unknown effect", { effect: "plasma" }, { effect: DEFAULT_BACKDROP.effect }],
    ["a picture path", { image: "../../etc/passwd" }, { image: DEFAULT_BACKDROP.image }],
    ["a picture URL", { image: "https://example.com/a.png" }, { image: DEFAULT_BACKDROP.image }],
    ["columns past the range", { lineColumns: 100_000 }, { lineColumns: BACKDROP_RANGES.lineColumns.max }],
    ["a negative grid", { dotStep: -5 }, { dotStep: BACKDROP_RANGES.dotStep.min }],
    ["a value off the step", { gamma: 1.234 }, { gamma: 1.25 }],
    ["not a number", { blur: Number.NaN }, { blur: DEFAULT_BACKDROP.blur }],
    ["a one-character ramp", { asciiCharacters: "#" }, { asciiCharacters: DEFAULT_BACKDROP.asciiCharacters }],
    ["control characters", { asciiCharacters: " .\u0007:#\n" }, { asciiCharacters: " .:#" }],
    ["levels crossed", { blackPoint: 200, whitePoint: 100 }, { blackPoint: 200, whitePoint: 201 }],
    ["dots inverted", { dotMin: 10, dotMax: 4 }, { dotMin: 4, dotMax: 4 }],
    ["a threshold past white", { threshold: 400 }, { threshold: 255 }],
    ["a dot straying more than a step", { dotNoise: 3 }, { dotNoise: 1 }],
  ];
  for (const [name, saved, expected] of hostile)
    it(`holds ${name} to what it may be`, () => {
      const settings = normalizeBackdrop(saved);
      for (const [key, value] of Object.entries(expected))
        assert.equal(settings[key as keyof typeof settings], value, key);
    });

  it("keeps a colour for each theme: light marks on the light page, dark ones on the dark", () => {
    assert.deepEqual(DEFAULT_BACKDROP.colors, { light: "#e8e8e8", dark: "#171717" });
    assert.deepEqual(normalizeBackdrop({ colors: { light: "#A1B2C3", dark: null } }).colors, {
      light: "#a1b2c3",
      dark: null,
    });
    // One colour saved before themes had their own is let go: each theme starts from its default.
    assert.deepEqual(normalizeBackdrop({ color: "#e8e8e8" }).colors, DEFAULT_BACKDROP.colors);
    for (const hostile of ["red", "url(x)", "#fff", 42, { r: 1 }])
      assert.deepEqual(
        normalizeBackdrop({ colors: { light: hostile, dark: hostile } }).colors,
        DEFAULT_BACKDROP.colors,
      );
  });

  it("cuts a long ramp to its longest", () => {
    assert.equal(normalizeBackdrop({ asciiCharacters: "x".repeat(200) }).asciiCharacters.length, 24);
  });
});

describe("a picture as ink", () => {
  it("dark is ink on a light page, light is ink on a dark one", () => {
    const light = coverageField(greys(0, 255), 2, 1, FLAT, false);
    const dark = coverageField(greys(0, 255), 2, 1, FLAT, true);
    assert.deepEqual([...light.values], [1, 0]);
    assert.deepEqual([...dark.values], [0, 1]);
  });

  it("levels stretch the range between the black and white points", () => {
    const field = coverageField(greys(50, 100, 150, 200), 4, 1, { ...FLAT, blackPoint: 100, whitePoint: 150 }, true);
    assert.deepEqual([...field.values], [0, 0, 1, 1]);
  });

  it("gamma above 1 lifts the midtones", () => {
    const flat = coverageField(greys(128), 1, 1, FLAT, true).values[0] ?? 0;
    const lifted = coverageField(greys(128), 1, 1, { ...FLAT, gamma: 2 }, true).values[0] ?? 0;
    assert.ok(lifted > flat, `${lifted} > ${flat}`);
  });

  it("grain is the same each time it is drawn, and stays within the ink's range", () => {
    const tone = { ...FLAT, grain: 1 };
    const once = coverageField(greys(...Array(64).fill(128)), 8, 8, tone, true);
    const again = coverageField(greys(...Array(64).fill(128)), 8, 8, tone, true);
    assert.deepEqual(once.values, again.values);
    assert.ok([...once.values].every((value) => value >= 0 && value <= 1));
    assert.ok(new Set(once.values).size > 1, "grain varies between samples");
    for (let index = 0; index < 1000; index++) assert.ok(grainAt(index) >= 0 && grainAt(index) < 1);
  });

  it("blends between samples and holds at the edges", () => {
    const field = { width: 2, height: 1, values: Float32Array.from([0, 1]) };
    assert.equal(coverageAt(field, 1, 0.5), 0.5);
    assert.equal(coverageAt(field, -10, 0.5), 0);
    assert.equal(coverageAt(field, 10, 0.5), 1);
  });

  it("a threshold leaves out ink below it and keeps the rest as it is", () => {
    assert.equal(thresholded(0.4, 128), 0);
    assert.equal(thresholded(0.6, 128), 0.6);
    assert.equal(thresholded(0.1, 0), 0.1);
  });

  it("picks the ramp's lightest for no ink and its densest for full ink", () => {
    const ramp = Array.from(" .:#");
    assert.equal(rampCharacter(ramp, 0), " ");
    assert.equal(rampCharacter(ramp, 1), "#");
    assert.equal(rampCharacter(ramp, 0.5), ":");
    assert.equal(rampCharacter(ramp, 7), "#");
  });
});

describe("a mark's colour", () => {
  it("reads hex and rgb, light to dark, and nothing else", () => {
    assert.equal(colorLightness("#ffffff"), 1);
    assert.equal(colorLightness("#000"), 0);
    assert.equal(colorLightness("rgb(255, 255, 255)"), 1);
    assert.equal(colorLightness("rgba(0 0 0 / 0.5)"), 0);
    const ink = colorLightness("#dee0e2") ?? 0;
    const page = colorLightness("#0e0d0f") ?? 1;
    assert.ok(ink > page, "the dark theme's text is lighter than its page");
    for (const unreadable of ["red", "", "color(srgb 1 1 1)", "#12345"]) assert.equal(colorLightness(unreadable), null);
  });
});

describe("a slider's value", () => {
  it("shows as many decimals as its step, so its width holds while dragged", () => {
    assert.equal(backdropDecimals("strength"), 2);
    assert.equal(backdropDecimals("dotMin"), 1);
    assert.equal(backdropDecimals("dotStep"), 0);
  });
});

describe("a picture cut to cover home", () => {
  it("a wide picture loses its sides, a tall one its top and bottom, centered", () => {
    assert.deepEqual(coverCrop(2000, 1000, 100, 100), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
    assert.deepEqual(coverCrop(1000, 2000, 100, 100), { sx: 0, sy: 500, sw: 1000, sh: 1000 });
  });
  it("a picture of the frame's shape is used whole", () => {
    assert.deepEqual(coverCrop(1600, 900, 800, 450), { sx: 0, sy: 0, sw: 1600, sh: 900 });
  });
});

describe("what home's background draws", () => {
  it("the whole window, whatever share of it home has, so showing or hiding the sidebar redraws nothing", () => {
    const window = { width: 1200, height: 800 };
    assert.deepEqual(homeView(window, 2), {
      frame: window,
      view: { x: 0, y: 0, width: 1200, height: 800 },
      scale: 2,
    });
  });
  it("past two pixels a point the marks look the same, so the density stops there", () => {
    assert.equal(homeView({ width: 100, height: 100 }, 3).scale, 2);
    assert.equal(homeView({ width: 100, height: 100 }, 1).scale, 1);
  });
  it("a preview is the window's drawing seen through home, at the preview's width", () => {
    const window = { width: 1200, height: 800 };
    const home = { x: 240, y: 0, width: 960, height: 800 };
    assert.deepEqual(previewView(window, home, 480, 2), { frame: window, view: home, scale: 1 });
  });
});
