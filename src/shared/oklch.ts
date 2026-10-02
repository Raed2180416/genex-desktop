/** Colour math the renderer's themes and the cover orbs share: `#rrggbb` to OKLCH and back. */

type Rgb = [number, number, number];
/** One two-digit hex channel of `#rrggbb` starting at `at`, as 0–1. */
const channel = (color: string, at: number) => parseInt(color.slice(at, at + 2), 16) / 255;
/** A `#rrggbb` colour's red, green and blue, each 0–1. */
export const channels = (color: string): Rgb => [channel(color, 1), channel(color, 3), channel(color, 5)];
/** Red, green and blue (0–1, clamped) as `#rrggbb`. */
export function rgbHex(c: number[]): string {
  return (
    "#" +
    c
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
/** A `#rrggbb` colour in OKLCH: lightness 0–1, chroma, hue in radians. */
export function oklch(color: string): [number, number, number] {
  const [r, g, b] = channels(color).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
/** OKLCH to sRGB hex, reducing chroma until the colour is inside the sRGB gamut. */
export function fromOklch(L: number, C: number, h: number): string {
  for (let c = C; ; c *= 0.96) {
    const A = c * Math.cos(h),
      B = c * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3,
      m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3,
      s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    if (rgb.every((v) => v >= -1e-4 && v <= 1.0001) || c < 1e-3) return rgbHex(rgb.map(toGamma));
  }
}
/** The same colour with its OKLCH hue turned by `degrees`, keeping lightness and chroma. */
export function turnHue(color: string, degrees: number): string {
  if (!degrees) return color;
  const [L, C, h] = oklch(color);
  return fromOklch(L, C, h + (degrees * Math.PI) / 180);
}
