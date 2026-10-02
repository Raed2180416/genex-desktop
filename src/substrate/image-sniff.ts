/**
 * Magic-byte sniffing for image files. A mood-board file's
 * declared type was trusted end to end once: an AVIF named `.jpg` was saved as JPEG, listed
 * as a reference, and silently dropped from every judge call (41 declared, 40 sent). Now the
 * bytes decide, at every boundary where an image enters or leaves the studio.
 */
export interface SniffedImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  ext: ".jpg" | ".png" | ".webp" | ".gif";
}

/** Fewer bytes than this cannot hold any header the sniffer reads (WebP's reaches byte 11). */
const MIN_SNIFF_BYTES = 12;

/** Bytes `data` must hold at `offset` for a signature to match. */
interface ByteRun {
  offset: number;
  bytes: readonly number[];
}

/** The containers the judges can read, each with the byte runs that identify it. */
const READABLE_SIGNATURES: ReadonlyArray<{ image: SniffedImage; runs: readonly ByteRun[] }> = [
  { image: { mimeType: "image/jpeg", ext: ".jpg" }, runs: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { image: { mimeType: "image/png", ext: ".png" }, runs: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }] },
  {
    // "RIFF" …size… "WEBP"
    image: { mimeType: "image/webp", ext: ".webp" },
    runs: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
  { image: { mimeType: "image/gif", ext: ".gif" }, runs: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
];

/** Formats the judges cannot read, named for the log line, by their leading bytes. */
const UNREADABLE_SIGNATURES: ReadonlyArray<{ name: string; bytes: readonly number[] }> = [
  { name: "TIFF", bytes: [0x49, 0x49, 0x2a] },
  { name: "TIFF", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { name: "BMP", bytes: [0x42, 0x4d] },
  { name: "SVG/XML", bytes: [0x3c] },
];

/** Whether `data` holds `run.bytes` starting at `run.offset`. */
function holds(data: Uint8Array, run: ByteRun): boolean {
  return run.bytes.every((byte, index) => data[run.offset + index] === byte);
}

/** The container a byte buffer actually is, or null for anything the judges cannot read. */
export function sniffImage(data: Uint8Array | Buffer): SniffedImage | null {
  if (!data || data.length < MIN_SNIFF_BYTES) return null;
  const match = READABLE_SIGNATURES.find((signature) => signature.runs.every((run) => holds(data, run)));
  return match ? { ...match.image } : null;
}

/** A readable name for what a refused file turned out to be, for the log line. */
export function describeUnknownImage(data: Uint8Array | Buffer): string {
  if (!data || data.length < MIN_SNIFF_BYTES) return "an empty or truncated file";
  const box = Buffer.from(data.subarray(4, 12)).toString("latin1");
  if (box.startsWith("ftyp")) {
    const brand = box.slice(4, 8).trim();
    if (/avi[fs]/i.test(brand)) return "AVIF";
    if (/hei[cfx]|mif1/i.test(brand)) return "HEIC";
    return `an ISO media file (${brand})`;
  }
  const known = UNREADABLE_SIGNATURES.find(({ bytes }) => holds(data, { offset: 0, bytes }));
  return known?.name ?? "an unrecognised format";
}

/** How much of a file is read to find an SVG's root element. */
const SVG_HEAD_BYTES = 1024;
/** An SVG document's opening: an optional XML declaration, comments and doctype, then `<svg`. */
const SVG_ROOT = /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>/]/i;

/** Whether bytes open as an SVG document. Shown only as an image (never navigated to), an SVG runs nothing. */
export function isSvgDocument(data: Uint8Array | Buffer): boolean {
  const head = Buffer.from(data.subarray(0, SVG_HEAD_BYTES))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return SVG_ROOT.test(head);
}

/** The picture type bytes really are: a readable bitmap by its magic bytes, or an SVG by its root element. */
export function pictureType(data: Uint8Array | Buffer): string | null {
  return sniffImage(data)?.mimeType ?? (isSvgDocument(data) ? "image/svg+xml" : null);
}
