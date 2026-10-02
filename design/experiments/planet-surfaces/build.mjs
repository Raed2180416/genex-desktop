import { readFileSync,writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { renderPlanet, EXAMPLES, SURFACES, PALETTES, LAYERS } from './index.mjs';
import { png } from '../spheres/png.mjs';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Genex planet surface recipe v2',
  type: 'object', additionalProperties: false, required: ['version', 'seed', 'surface', 'palette'],
  properties: {
    version: { const: 2 }, seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
    surface: { enum: SURFACES }, layer: { enum: [...new Set(Object.values(LAYERS).flat())], default: 'none' },
    palette: { enum: Object.keys(PALETTES) },
  },
  allOf: Object.entries(LAYERS).map(([surface, layers]) => ({
    if: { properties: { surface: { const: surface } } },
    then: { properties: { layer: { enum: layers } } },
  })),
};
writeFileSync(new URL('recipe.schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');

const bundle=await build({entryPoints:[new URL('index.mjs',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'PlanetSurfaces',target:'es2022',minify:true});
const bundleSource=bundle.outputFiles[0].text;
const font=name=>readFileSync(new URL(`../../../src/renderer/fonts/${name}`,import.meta.url)).toString('base64');
const uri=art=>`data:image/png;base64,${png(art.width,art.height,art.data).toString('base64')}`;
const images=EXAMPLES.map(item=>uri(renderPlanet(item.recipe,224)));
const hero=uri(renderPlanet(EXAMPLES[0].recipe,416));
const names={ocean:'Океаны и материки',craters:'Кратеры',bands:'Газовые полосы',marble:'Жидкий мрамор','cloud-pearl':'Cloud pearl'};
const cards=(start,end)=>EXAMPLES.slice(start,end).map((item,j)=>{const i=start+j;return `<button type="button" class="specimen" data-example="${i}" aria-pressed="${i===0}"><img src="${images[i]}" alt="" width="224" height="224"><span>${item.name}</span><span class="specimen-small"><img src="${images[i]}" alt="At sidebar size" width="28" height="28"><small>28 px</small></span></button>`;}).join('');
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genex — Поверхности планет</title><style>
@font-face{font-family:StudySans;src:url(data:font/woff2;base64,${font('ZalandoSansSemiExpanded-variable.woff2')}) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:StudyMono;src:url(data:font/woff2;base64,${font('GeistMono-variable.woff2')}) format('woff2');font-weight:100 900;font-display:swap}
${readFileSync(new URL('../spheres/styles.css',import.meta.url),'utf8')}
${readFileSync(new URL('styles.css',import.meta.url),'utf8')}
</style></head><body><main>
<header class="page-header"><div><p class="eyebrow">GENEX <span>/</span> PLANET SURFACES</p><h1>Поверхности планет.</h1><p class="intro">Один шар. Разные материалы, рельеф и рисунок.</p></div><button type="button" id="background" class="quiet-button" aria-pressed="false">Светлый фон</button></header>
<section aria-labelledby="families-title"><div class="section-heading"><h2 id="families-title">Поверхности</h2><button type="button" id="one-color" class="text-button" aria-pressed="false">Сравнить в одном цвете</button></div><div class="catalog">${cards(0,4)}</div></section>
<section class="workbench" aria-label="Редактор поверхности"><div class="preview-column"><div class="stage"><img id="hero" src="${hero}" alt="Планета с океанами и материками" width="416" height="416"></div><div class="preview-foot"><div class="inline-row"><img id="row-image" src="${hero}" width="28" height="28" alt=""><span id="row-name">Океаны и материки</span></div><button type="button" id="save-png" class="text-button">Сохранить PNG ↗</button></div></div><div class="recipe-column"><h2>Смешать слои</h2><form id="mixer"><div class="field-pair"><label>Поверхность<select id="surface">${SURFACES.map(id=>`<option value="${id}">${names[id]}</option>`).join('')}</select></label><label>Слой<select id="layer"><option value="none">Без слоя</option><option value="clouds">Облака</option><option value="frost">Иней</option></select></label></div><div class="field-pair"><label>Палитра<select id="palette">${Object.keys(PALETTES).map(id=>`<option value="${id}">${id[0].toUpperCase()+id.slice(1)}</option>`).join('')}</select></label><label>Seed<input type="number" id="seed" min="0" max="4294967295" value="127" required></label></div><div class="recipe-actions"><button type="button" id="new-seed" class="quiet-button">Другой рисунок ↻</button><button type="button" id="copy-recipe" class="text-button">Копировать рецепт</button></div></form><pre id="recipe" tabindex="0" aria-label="Рецепт поверхности">${JSON.stringify(EXAMPLES[0].recipe,null,2)}</pre><p class="recipe-note">Короткий рецепт. Локальный рендер без генерации изображений через ИИ.</p><details class="brief-panel"><summary>Попробовать описание игры</summary><label for="brief">Описание игры</label><textarea id="brief" rows="2" placeholder="Игра об исследовании океанической планеты"></textarea><button type="button" id="from-brief" class="quiet-button">Создать вариант</button><p>Текст задаёт seed. Агент может явно выбрать поверхность и дополнительный слой.</p></details><p id="status" role="status" aria-live="polite">Готово · локальный рендер</p></div></section>
<section aria-labelledby="mixes-title"><div class="section-heading"><h2 id="mixes-title">Смешанные поверхности</h2><span class="section-note">Базовая поверхность + дополнительный слой</span></div><div class="catalog mixes">${cards(5,9)}</div></section>
<footer class="study-footer"><div class="default-preview"><img src="${images[4]}" width="40" height="40" alt="Cloud pearl — плейсхолдер"><div><strong>Cloud pearl</strong><span>Плейсхолдер до первого описания игры.</span></div></div><p>Сохраняется один раз и не меняется от новых сообщений.</p></footer>
<noscript><p>Примеры доступны без JavaScript. Для редактора включите JavaScript.</p></noscript></main>
<script>${bundleSource}\n${readFileSync(new URL('controls.js',import.meta.url),'utf8')}</script></body></html>`;
const out=new URL('../ag-966-planet-surfaces.html',import.meta.url);writeFileSync(out,html);
console.log(out.pathname);console.log(`${Math.round(Buffer.byteLength(html)/1024)} KB, self-contained`);
