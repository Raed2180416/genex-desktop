/** Standalone art study. No production imports, assets, network or animation loop. */
export function createSphereRenderer(seed = 23) {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const perm = new Uint8Array(512);
  const deck = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = deck[i & 255];
  const offset = [random() * 80, random() * 80, random() * 80];
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function grad(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  function noise(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return mix(mix(mix(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
      mix(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    mix(mix(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
      mix(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  function fbm(x, y, z, octaves = 5) {
    let value = 0, amplitude = .53;
    for (let k = 0; k < octaves; k++) {
      value += amplitude * noise(x, y, z);
      x = x * 2.03 + 13.1; y = y * 2.03 + 7.7; z = z * 2.03 + 4.3;
      amplitude *= .49;
    }
    return value;
  }
  function tint(hue) {
    // Blue→periwinkle→violet stays on a tightly art-directed cool ramp.
    const t = clamp((hue - 195) / 80);
    return [mix(.035, .30, t), mix(.29, .055, t), mix(.70, .69, t)];
  }
  const light = [-.43, .54, .724];
  return function render({ size = 384, variant = 'chrome', hue = 226, color, gloss = .7, detail = .55, turn = 0 } = {}) {
    size = Math.max(16, Math.min(1024, Math.round(size)));
    const rgba = new Uint8ClampedArray(size * size * 4);
    const base = color ? color.map(c => clamp(c)) : tint(hue), pale = base.map(c => mix(c, 1, .84));
    const ca = Math.cos(turn), sa = Math.sin(turn);
    const radius = .88, edge = 3 / size;
    for (let py = 0; py < size; py++) {
      const y = (1 - 2 * (py + .5) / size) / radius;
      for (let px = 0; px < size; px++) {
        const x = (2 * (px + .5) / size - 1) / radius;
        const r2 = x * x + y * y;
        if (r2 >= 1) continue;
        const z = Math.sqrt(1 - r2), r = Math.sqrt(r2);
        // Reflection coordinates curve naturally and compress toward the silhouette.
        const rx = 2 * x * z, ry = 2 * y * z, rz = 2 * z * z - 1;
        const tx = ca * rx - sa * rz, tz = sa * rx + ca * rz;
        const nx = ca * x - sa * z, nz = sa * x + ca * z;
        const lx = nx * (2.3 + detail * 2.8) + offset[0];
        const ly = y * (2.1 + detail * 1.5) + offset[1];
        const lz = nz * (2.3 + detail * 2.8) + offset[2];
        const n = fbm(lx, ly, lz);
        const fine = noise(lx * 7, ly * 7, lz * 7);
        const ndl = Math.max(0, x * light[0] + y * light[1] + z * light[2]);
        const fresnel = Math.pow(1 - z, 3);
        let color;
        if (variant === 'chrome') {
          // A reflected sky, with a sloping horizon and a cool mirrored floor.
          const cloudScale = .65 + detail * 3;
          const cloud = fbm(tx * cloudScale + offset[0], ry * (cloudScale + .5) + offset[1], tz * cloudScale + offset[2], 6);
          const density = smooth(-.11, .25, cloud + .075 * fine);
          const horizon = ry + .29 + tx * .17;
          const sky = base.map((c, k) => mix(c * (.50 + .60 * Math.max(0, ry)), pale[k], density * .96));
          const band = Math.exp(-Math.pow((horizon + .035) / .066, 2));
          const bounce = Math.exp(-Math.pow((ry + .80) / .21, 2));
          const reflected = (.12 + .68 * smooth(-.90, -.32, ry)) * (.8 + .17 * n);
          const seam = Math.exp(-Math.pow((tx * .56 + tz * .22 + ry + .42) / .027, 2));
          const sheen = Math.exp(-Math.pow((tx * .49 + ry + .75) / .095, 2));
          const floor = base.map((c, k) => reflected * mix(c, 1, .84) + bounce * .22 + band * .38 + sheen * .09 - seam * .07);
          const blend = smooth(-.023, .024, horizon);
          color = floor.map((c, k) => mix(c, sky[k], blend));
          color = color.map(c => c * (.77 + .23 * z));
        } else if (variant === 'pearl') {
          // Diffuse clouds under a translucent, smoothly shaded coating.
          const cloud = smooth(-.16, .23, n + fine * .025);
          const depth = (.55 + .45 * ndl) * (.88 + .12 * z);
          color = base.map((c, k) => mix(mix(c, 1, .28), pale[k], cloud * .87) * depth);
          const ribbon = Math.exp(-Math.pow((n + y * .14 + .045) / .075, 2));
          color = color.map((c, k) => mix(c, mix(base[k], 1, .78), ribbon * .14));
        } else if (variant === 'iris') {
          // Abstract optical iris: off-axis cavity, radial fibers, glass coating.
          const ix = x + .105 * z, iy = y - .025 * z;
          const ir = Math.sqrt(ix * ix + iy * iy);
          const theta = Math.atan2(iy, ix);
          const warp = n * .026;
          const fibers = .5 + .5 * Math.sin(theta * 148 + fbm(nx * 6 + offset[0], y * 6, nz * 6) * 12 + ir * 28);
          const spokes = Math.pow(fibers, 5) * (.55 + .45 * Math.sin(theta * 43 + ir * 13));
          const ring = Math.exp(-Math.pow((ir + warp - .30) / .066, 2));
          const body = .42 + .34 * n + .27 * spokes;
          color = base.map((c, k) => mix(c * .6, pale[k], body) * (.69 + .31 * ndl) + ring * .18);
          const pupil = smooth(.195, .219, ir + warp * .14);
          color = color.map((c, k) => mix([.012, .022, .050][k], c, pupil));
          const outer = smooth(.84, 1, ir);
          color = color.map(c => c * (1 - .66 * outer));
        } else {
          // A quiet default pearl, visibly related to the three material studies.
          color = [.41, .47, .59].map(c => c * (.57 + .43 * ndl));
          const environment = Math.exp(-Math.pow((ry - .28) / .36, 2));
          color = color.map(c => c + environment * .16);
        }
        const reflLight = rx * light[0] + ry * light[1] + rz * light[2];
        const softbox = Math.exp(-(((rx + .49) / .26) ** 2 + ((ry - .59) / .18) ** 2)) * smooth(.12, .5, rz);
        const spec = Math.pow(Math.max(0, reflLight), 170) * .90;
        const bloom = Math.pow(Math.max(0, reflLight), 18) * .16;
        const lowerRim = fresnel * (.11 + .10 * Math.max(0, -y));
        // A second, thinner studio reflection keeps the dark side legible.
        const strip = Math.exp(-(((rx - .91) / .075) ** 2 + ((ry + .02) / .64) ** 2)) * .15;
        const highlight = (softbox * .90 + spec + bloom + strip) * gloss;
        const alpha = smooth(0, edge, 1 - r);
        const idx = (py * size + px) * 4;
        for (let k = 0; k < 3; k++) {
          const lit = color[k] * (1 - fresnel * .30) + lowerRim * pale[k];
          // Screen-shaped specular rolloff avoids clipped white patches.
          rgba[idx + k] = Math.round(255 * clamp(1 - (1 - lit) * Math.exp(-highlight * 2.4)));
        }
        rgba[idx + 3] = Math.round(alpha * 255);
      }
    }
    return { width: size, height: size, data: rgba };
  };
}
