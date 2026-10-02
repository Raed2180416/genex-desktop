import { readFileSync, writeFileSync } from 'node:fs';
import { createSphereRenderer } from './renderer.mjs';
import { png } from './png.mjs';

const variants = [
  { id: 'chrome', name: 'Sky + chrome', note: 'Cloud reflections. A mirrored horizon.', number: '01' },
  { id: 'pearl', name: 'Cloud pearl', note: 'Soft clouds beneath a glossy surface.', number: '02' },
  { id: 'iris', name: 'Abstract iris', note: 'Radial fibers. A deep, dark center.', number: '03' },
];
const games = ['Neon drift', 'Cloud runner', 'After hours', 'Orbital garden', 'Silent ocean'];
const palette = [226, 208, 249, 237, 214];
const dataImage = (variant, seed, hue, size) => {
  const r = createSphereRenderer(seed)({ variant, hue, size });
  return `data:image/png;base64,${png(r.width, r.height, r.data).toString('base64')}`;
};
const fonts = name => readFileSync(new URL(`../../../src/renderer/fonts/${name}`, import.meta.url)).toString('base64');
const controls = readFileSync(new URL('controls.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('styles.css', import.meta.url), 'utf8');
const columns = variants.map(v => {
  const hero = dataImage(v.id, 23, 226, 480);
  const rows = games.map((name, i) => `<button class="game-row${i === 0 ? ' selected' : ''}" type="button" data-game="${i}" data-style="${v.id}" aria-pressed="${i === 0}"><img class="game-picture" data-art="${v.id}-${i}" src="${dataImage(v.id, 23 + i * 107, palette[i], 112)}" alt="" width="28" height="28"><span>${name}</span><span class="more" aria-hidden="true">···</span></button>`).join('');
  return `<article class="study" data-study="${v.id}" aria-labelledby="heading-${v.id}">
    <header class="study-heading"><span class="number">${v.number}</span><h2 id="heading-${v.id}">${v.name}</h2></header>
    <div class="stage"><img data-hero="${v.id}" src="${hero}" alt="${v.name} procedural sphere" width="480" height="480"></div>
    <p class="material-note">${v.note}</p>
    <div class="size-strip" aria-label="Actual icon sizes"><span><img data-small="${v.id}" src="${hero}" alt="${v.name} at 28 pixels" width="28" height="28"><small>28</small></span><span><img data-small="${v.id}" src="${hero}" alt="${v.name} at 40 pixels" width="40" height="40"><small>40</small></span><span><img data-small="${v.id}" src="${hero}" alt="${v.name} at 64 pixels" width="64" height="64"><small>64 px</small></span><button type="button" class="text-button" data-save="${v.id}" data-rendered-seed="23">Save PNG <span aria-hidden="true">↗</span></button></div>
    <section class="sidebar" aria-label="${v.name} in the sidebar"><div class="sidebar-header">Games <span aria-hidden="true">+</span></div>${rows}</section>
  </article>`;
}).join('');
const fallback = dataImage('default', 23, 226, 112);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><title>Genex — Sphere studies</title>
<style>
@font-face{font-family:StudySans;src:url(data:font/woff2;base64,${fonts('ZalandoSansSemiExpanded-variable.woff2')}) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:StudyMono;src:url(data:font/woff2;base64,${fonts('GeistMono-variable.woff2')}) format('woff2');font-weight:100 900;font-display:swap}
${styles}
</style></head><body>
<main>
  <header class="page-header"><div><p class="eyebrow">GENEX <span>/</span> ART STUDY 02</p><h1>A small world.</h1><p class="intro">Three sphere materials. One place to find the right feeling.</p></div><button id="background" type="button" class="quiet-button" aria-pressed="false">Light background</button></header>
  <form class="controls" aria-label="Sphere material controls" onsubmit="return false">
    <label class="seed-field">Seed <input id="seed" type="number" min="1" max="999999" value="23" inputmode="numeric"></label>
    <button id="shuffle" type="button" class="quiet-button" title="Try a new arrangement">New seed <span aria-hidden="true">↻</span></button>
    <label class="slider-field">Tint <input id="hue" type="range" min="195" max="275" value="226"><output for="hue" id="hue-value">226°</output></label>
    <label class="slider-field">Gloss <input id="gloss" type="range" min="0" max="100" value="70"><output for="gloss" id="gloss-value">70%</output></label>
    <label class="slider-field">Cloud detail <input id="detail" type="range" min="0" max="100" value="55"><output for="detail" id="detail-value">55%</output></label>
    <button id="reset" type="button" class="text-button">Reset</button>
  </form>
  <div class="studies">${columns}</div>
  <footer class="study-footer"><div class="default-preview"><img src="${fallback}" alt="Neutral silver-blue sphere" width="40" height="40"><div><strong>Before the first brief</strong><span>A quiet silver-blue default.</span></div></div><p id="status" role="status" aria-live="polite">Ready · generated locally</p></footer>
  <p class="footnote">Click a game row to inspect its sphere. Rendered once; no ongoing animation or AI calls.</p>
  <noscript><p class="notice">These previews work without JavaScript. Enable JavaScript to adjust the materials.</p></noscript>
</main>
<nav class="variant-picker" aria-label="Variants"><button type="button" data-variant="all" aria-current="true">Compare</button>${variants.map(v => `<button type="button" data-variant="${v.id}">${v.name}</button>`).join('')}</nav>
<script>${createSphereRenderer.toString()}
${controls}
</script></body></html>`;
const output = new URL('../ag-966-spheres.html', import.meta.url);
writeFileSync(output, html);
console.log(output.pathname);
console.log(`${Math.round(Buffer.byteLength(html) / 1024)} KB; all art, fonts, controls and rendering code embedded.`);
