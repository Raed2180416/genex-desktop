/** Hue, saturation and value: the colour picker's square (saturation × value) and hue strip. */
export type Hsv = { h: number; s: number; v: number };

/** Which sixth of the hue circle the brightest channel puts the colour in, as a fraction of sixths. */
function hueSector(r: number, g: number, b: number, max: number, d: number): number {
  if (max === r) return ((g - b) / d + 6) % 6;
  if (max === g) return (b - r) / d + 2;
  return (r - g) / d + 4;
}

/** A `#rrggbb` colour as HSV: hue in degrees 0–360, saturation and value 0–1. */
export function hexToHsv(color: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return { h: 0, s, v: max };
  return { h: hueSector(r, g, b, max, d) * 60, s, v: max };
}

/** An HSV colour as `#rrggbb`. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number): string => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}
