/**
 * The page's first paint: with nothing saved, a first launch follows the system's light or dark;
 * a saved choice wins; and the chosen scheme and its palette are on the root before anything draws.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paintAppearance, savedAppearance } from "../../src/renderer/appearance/paint.ts";
import { AppearanceMode, paletteFor, resolveScheme, Scheme } from "../../src/renderer/appearance/themes.ts";

/** A stand-in for the root element: its data attributes and its style properties. */
function fakeRoot() {
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      colorScheme: "",
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
  };
  return { root, element: root as unknown as HTMLElement, properties };
}

describe("first paint", () => {
  it("follows the system's light or dark when nothing is saved", () => {
    const { appearance } = savedAppearance();
    assert.equal(appearance.mode, AppearanceMode.System);
    assert.equal(resolveScheme(appearance.mode, false), Scheme.Light);
    assert.equal(resolveScheme(appearance.mode, true), Scheme.Dark);
  });

  it("keeps a saved light or dark whatever the system says", () => {
    assert.equal(resolveScheme(AppearanceMode.Light, true), Scheme.Light);
    assert.equal(resolveScheme(AppearanceMode.Dark, false), Scheme.Dark);
  });

  it("puts the scheme and its palette on the root", () => {
    const { appearance } = savedAppearance();
    const { root, element, properties } = fakeRoot();
    const painted = paintAppearance(element, appearance, Scheme.Light);
    assert.equal(root.dataset.theme, Scheme.Light);
    assert.equal(root.style.colorScheme, Scheme.Light);
    assert.equal(properties.get("--background"), paletteFor(appearance, Scheme.Light).background);
    assert.ok(painted.has("--background"));
  });

  it("removes a variable the next palette leaves out", () => {
    const { appearance } = savedAppearance();
    const { element, properties } = fakeRoot();
    const painted = paintAppearance(element, appearance, Scheme.Dark, null, new Set(["--left-over"]));
    properties.set("--left-over", "#000000");
    paintAppearance(element, appearance, Scheme.Dark, null, new Set([...painted, "--left-over"]));
    assert.equal(properties.has("--left-over"), false);
  });
});
