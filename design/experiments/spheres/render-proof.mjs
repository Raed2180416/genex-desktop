import { png } from './png.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSphereRenderer } from './renderer.mjs';

// Exercise the exact software renderer embedded in the HTML without browser automation.
const out = new URL('../../../.studio-dev/spheres/', import.meta.url);
mkdirSync(out, { recursive: true });

const width = 1440, height = 510;
const sheet = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < sheet.length; i += 4) sheet.set([28, 28, 31, 255], i);
function composite(image, left, top, size = image.width) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = (Math.floor(y * image.height / size) * image.width + Math.floor(x * image.width / size)) * 4;
    const q = ((top + y) * width + left + x) * 4, a = image.data[p + 3] / 255;
    for (let k = 0; k < 3; k++) sheet[q + k] = sheet[q + k] * (1 - a) + image.data[p + k] * a;
  }
}
const reports = [];
for (const [i, variant] of ['chrome', 'pearl', 'iris', 'default'].entries()) {
  const t = performance.now();
  const image = createSphereRenderer(23)({ size: 352, variant, hue: 230 });
  const durationMs = performance.now() - t;
  writeFileSync(new URL(`${variant}.png`, out), png(image.width, image.height, image.data));
  composite(image, i * 360 + 4, 10);
  for (let j = 0; j < 4; j++) {
    const small = createSphereRenderer(23 + j * 107)({ size: 112, variant, hue: 211 + j * 14 });
    composite(small, i * 360 + 70 + j * 55, 386, 32);
  }
  composite(image, i * 360 + 124, 450, 28);
  composite(image, i * 360 + 176, 446, 40);
  reports.push({ variant, size: image.width, durationMs: Math.round(durationMs), sha256: createHash('sha256').update(image.data).digest('hex') });
}
writeFileSync(new URL('contact-sheet.png', out), png(width, height, sheet));
const a = createSphereRenderer(12)({ size: 64 });
const b = createSphereRenderer(12)({ size: 64 });
const c = createSphereRenderer(13)({ size: 64 });
if (Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) !== 0 || Buffer.compare(Buffer.from(a.data), Buffer.from(c.data)) === 0) throw Error('Seed identity check failed');
writeFileSync(new URL('render-report.json', out), JSON.stringify({ node: process.version, seedStable: true, renders: reports }, null, 2));
console.log(JSON.stringify(reports));
console.log(new URL('contact-sheet.png', out).pathname);
