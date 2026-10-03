/**
 * What a fast scroll of the chat looked like, from the frames the compositor painted (screencast
 * bitmaps) and the CPU profile taken meanwhile. Pure: the Electron driver hands in pixels and
 * profiles, these functions say how much of the viewport was empty and where the time went.
 */

/** A painted frame as BGRA pixels, with how many image pixels one CSS pixel spans. */
export interface PaintedFrame {
  width: number;
  height: number;
  /** Image pixels per CSS pixel. */
  scale: number;
  pixels: Uint8Array;
}

/** The conversation's box in CSS pixels. */
export interface Band {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A pixel within this many levels per channel of the background is background (JPEG ringing included). */
const BACKGROUND_TOLERANCE = 14;
/** Where the background is read in each line: inside the scroller's left padding, before any text (CSS px). */
const GUTTER_PX = 6;
/** The overlay scrollbar's strip at the right, never read (CSS px). */
const SCROLLBAR_PX = 18;
/** Every how many image pixels a line is read: text is never thinner than this. */
const STEP_PX = 2;

/** Whether one image line of the band is nothing but the background read at its gutter. */
function blankLine(frame: PaintedFrame, y: number, from: number, to: number, gutter: number): boolean {
  const at = (x: number) => (y * frame.width + x) * 4;
  const ref = at(gutter);
  for (let x = from; x < to; x += STEP_PX) {
    const i = at(x);
    for (let c = 0; c < 3; c++)
      if (Math.abs((frame.pixels[i + c] ?? 0) - (frame.pixels[ref + c] ?? 0)) > BACKGROUND_TOLERANCE) return false;
  }
  return true;
}

/** The tallest run of empty lines inside the band, in CSS pixels: how big a blank block the frame showed. */
export function blankRunPx(frame: PaintedFrame, band: Band): number {
  const px = (css: number) => Math.round(css * frame.scale);
  const top = Math.max(0, px(band.top));
  const bottom = Math.min(frame.height, px(band.bottom));
  const gutter = px(band.left + GUTTER_PX);
  const from = gutter + STEP_PX;
  const to = Math.min(frame.width, px(band.right - SCROLLBAR_PX));
  let longest = 0;
  let run = 0;
  for (let y = top; y < bottom; y++) {
    run = blankLine(frame, y, from, to, gutter) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return Math.round(longest / frame.scale);
}

/** A V8 CPU profile, as `Profiler.stop` returns it. */
export interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
  samples: number[];
  timeDeltas: number[];
}

/** Where a fast scroll's main-thread time went: by source module and by function, in ms. */
export interface ProfileSummary {
  totalMs: number;
  byModule: { module: string; ms: number }[];
  byFunction: { name: string; module: string; ms: number }[];
}

/** How many rows of each ranking a summary keeps. */
const TOP_ROWS = 25;

/**
 * Line → module of an unminified esbuild bundle, from the `// path` comment esbuild writes above
 * each module. Lines are 0-based, as the profile counts them.
 */
export function bundleModules(source: string): (line: number) => string {
  const starts: { line: number; module: string }[] = [];
  source.split("\n").forEach((text, line) => {
    const match = /^\/\/ ((?:node_modules|src|tests|design)\/\S+)$/.exec(text);
    if (match?.[1]) starts.push({ line, module: packageOf(match[1]) });
  });
  return (line) => {
    let found = "(bundle)";
    for (const start of starts) {
      if (start.line > line) break;
      found = start.module;
    }
    return found;
  };
}

/** A dependency counts as its package; the app's own code as its file. */
function packageOf(file: string): string {
  const parts = file.split("/");
  if (parts[0] !== "node_modules") return file;
  return parts[1]?.startsWith("@") ? `${parts[1]}/${parts[2]}` : (parts[1] ?? file);
}

/** Self time per module and per function; native work (layout, style, paint, GC) stays in its own `(…)` rows. */
export function summarizeProfile(
  profile: CpuProfile,
  moduleOf: (line: number) => string,
  bundleUrl: string,
): ProfileSummary {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const modules = new Map<string, number>();
  const functions = new Map<string, { name: string; module: string; ms: number }>();
  for (const [id, micros] of self) {
    const frame = nodes.get(id);
    if (!frame) continue;
    const module = frame.url.endsWith(bundleUrl)
      ? moduleOf(frame.lineNumber)
      : frame.url
        ? "(other script)"
        : frame.functionName;
    if (module === "(idle)") continue;
    modules.set(module, (modules.get(module) ?? 0) + micros / 1000);
    const key = `${module}:${frame.functionName}:${frame.lineNumber}`;
    const row = functions.get(key) ?? { name: frame.functionName || "(anonymous)", module, ms: 0 };
    row.ms += micros / 1000;
    functions.set(key, row);
  }
  const round = (ms: number) => Math.round(ms * 10) / 10;
  return {
    totalMs: round([...modules.values()].reduce((sum, ms) => sum + ms, 0)),
    byModule: [...modules]
      .map(([module, ms]) => ({ module, ms: round(ms) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, TOP_ROWS),
    byFunction: [...functions.values()]
      .map((row) => ({ ...row, ms: round(row.ms) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, TOP_ROWS),
  };
}
