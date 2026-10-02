/**
 * A minimal, dependency-free PNG decoder and encoder.
 *
 * The prober's pixel analysis runs on raw RGBA in Node. Chromium emits 8-bit non-interlaced
 * RGB/RGBA, but grayscale, 16-bit and palette forms are handled too so a synthetic fixture written
 * by any tool still decodes. Pure: buffer in, RGBA out. No I/O.
 */
import { deflateSync, inflateSync } from "node:zlib";

/** An RGBA frame, 4 bytes per pixel, row-major, top-left origin. */
export interface RawFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CRC_POLYNOMIAL = 0xedb88320;

/** PNG colour types (IHDR byte 9). */
const ColorType = {
  Gray: 0,
  Rgb: 2,
  Palette: 3,
  GrayAlpha: 4,
  Rgba: 6,
} as const;

/** PNG scanline filters (the first byte of each row). */
const Filter = {
  None: 0,
  Sub: 1,
  Up: 2,
  Average: 3,
  Paeth: 4,
} as const;

const CHANNELS: Record<number, number> = {
  [ColorType.Gray]: 1,
  [ColorType.Rgb]: 3,
  [ColorType.Palette]: 1,
  [ColorType.GrayAlpha]: 2,
  [ColorType.Rgba]: 4,
};

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

interface Chunks {
  header: Header;
  palette: Uint8Array | null;
  paletteAlpha: Uint8Array | null;
  idat: Uint8Array[];
}

/** The decoded scanlines and how to read one sample out of them. */
interface Scanlines {
  header: Header;
  lines: Uint8Array;
  bytesPerRow: number;
  channels: number;
}

function channelsFor(colorType: number): number {
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new Error(`png: unsupported color type ${colorType}`);
  return channels;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function assertSignature(buffer: Uint8Array): void {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buffer[i] !== SIGNATURE[i]) throw new Error("png: bad signature");
  }
}

/** Walk the chunks once: the header, the palette, and every IDAT slice. */
function readChunks(buffer: Uint8Array): Chunks {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const chunks: Chunks = {
    header: { width: 0, height: 0, bitDepth: 8, colorType: ColorType.Rgba },
    palette: null,
    paletteAlpha: null,
    idat: [],
  };
  let offset = SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(buffer[offset + 4], buffer[offset + 5], buffer[offset + 6], buffer[offset + 7]);
    const start = offset + 8;
    if (type === "IEND") break;
    readChunk(chunks, type, buffer.subarray(start, start + length), view, start);
    offset = start + length + 4;
  }
  return chunks;
}

function readChunk(chunks: Chunks, type: string, body: Uint8Array, view: DataView, start: number): void {
  if (type === "IHDR") {
    if (body[12] !== 0) throw new Error("png: interlaced images are not supported");
    chunks.header = {
      width: view.getUint32(start),
      height: view.getUint32(start + 4),
      bitDepth: body[8],
      colorType: body[9],
    };
    return;
  }
  if (type === "PLTE") chunks.palette = body;
  else if (type === "tRNS" && chunks.header.colorType === ColorType.Palette) chunks.paletteAlpha = body;
  else if (type === "IDAT") chunks.idat.push(body);
}

function unfilterByte(filter: number, value: number, left: number, up: number, upLeft: number, row: number): number {
  if (filter === Filter.None) return value;
  if (filter === Filter.Sub) return value + left;
  if (filter === Filter.Up) return value + up;
  if (filter === Filter.Average) return value + ((left + up) >> 1);
  if (filter === Filter.Paeth) return value + paethPredictor(left, up, upLeft);
  throw new Error(`png: unknown filter ${filter} on row ${row}`);
}

/** Inflate the IDAT stream and undo the per-row filters into one contiguous scanline buffer. */
function unfilter(chunks: Chunks): Scanlines {
  const { header } = chunks;
  const raw = inflateSync(Buffer.concat(chunks.idat.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
  const channels = channelsFor(header.colorType);
  const bitsPerPixel = channels * header.bitDepth;
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const bytesPerRow = Math.ceil((header.width * bitsPerPixel) / 8);
  const expected = header.height * (bytesPerRow + 1);
  if (raw.length < expected) throw new Error(`png: truncated pixel data (${raw.length} < ${expected})`);
  const lines = new Uint8Array(header.height * bytesPerRow);
  let rawPos = 0;
  for (let y = 0; y < header.height; y++) {
    const filter = raw[rawPos++];
    const lineStart = y * bytesPerRow;
    const prevStart = lineStart - bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const left = x >= bytesPerPixel ? lines[lineStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? lines[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? lines[prevStart + x - bytesPerPixel] : 0;
      lines[lineStart + x] = unfilterByte(filter, raw[rawPos + x], left, up, upLeft, y) & 0xff;
    }
    rawPos += bytesPerRow;
  }
  return { header, lines, bytesPerRow, channels };
}

/** One sample (channel value) of row `y`, index `index`, at the image's own bit depth. */
function sampleAt(s: Scanlines, y: number, index: number): number {
  const { bitDepth } = s.header;
  const lineStart = y * s.bytesPerRow;
  if (bitDepth === 8) return s.lines[lineStart + index];
  // The most significant byte is enough for 8-bit analysis.
  if (bitDepth === 16) return s.lines[lineStart + index * 2];
  const bitPos = index * bitDepth;
  const byte = s.lines[lineStart + (bitPos >> 3)];
  const shift = 8 - bitDepth - (bitPos & 7);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

/** Write one pixel of a non-palette image as RGBA. */
function writeDirect(s: Scanlines, data: Uint8Array, x: number, y: number, scale: number): void {
  const o = (y * s.header.width + x) * 4;
  const base = x * s.channels;
  const at = (k: number) => Math.round(sampleAt(s, y, base + k) * scale);
  const { colorType } = s.header;
  const gray = colorType === ColorType.Gray || colorType === ColorType.GrayAlpha;
  if (gray) {
    const g = at(0);
    data.set([g, g, g, colorType === ColorType.GrayAlpha ? at(1) : 255], o);
    return;
  }
  data.set([at(0), at(1), at(2), colorType === ColorType.Rgba ? at(3) : 255], o);
}

function writePalette(s: Scanlines, chunks: Chunks, data: Uint8Array, x: number, y: number): void {
  const { palette, paletteAlpha } = chunks;
  if (!palette) throw new Error("png: palette image without PLTE");
  const idx = sampleAt(s, y, x);
  const alpha = paletteAlpha && idx < paletteAlpha.length ? paletteAlpha[idx] : 255;
  data.set([palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], alpha], (y * s.header.width + x) * 4);
}

/** Decode a PNG buffer into an RGBA frame. Throws on anything it cannot honestly decode. */
export function decodePng(buffer: Uint8Array): RawFrame {
  assertSignature(buffer);
  const chunks = readChunks(buffer);
  const { width, height, bitDepth, colorType } = chunks.header;
  if (width <= 0 || height <= 0) throw new Error("png: missing or empty IHDR");
  if (chunks.idat.length === 0) throw new Error("png: no IDAT data");
  const scanlines = unfilter(chunks);
  const data = new Uint8Array(width * height * 4);
  const scale = 255 / (bitDepth === 16 ? 255 : (1 << bitDepth) - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (colorType === ColorType.Palette) writePalette(scanlines, chunks, data, x, y);
      else writeDirect(scanlines, data, x, y, scale);
    }
  }
  return { width, height, data };
}

/** Encode an RGBA frame as a PNG with no row filtering. Used by tests and for derived frames. */
export function encodePng(frame: RawFrame): Uint8Array {
  const { width, height, data } = frame;
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = Filter.None;
    Buffer.from(data.buffer, data.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = ColorType.Rgba;
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))];
  return Uint8Array.from(Buffer.concat([Buffer.from(SIGNATURE), ...chunks]));
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
