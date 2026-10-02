import { readFileSync, writeFileSync } from 'node:fs';
import { createSphereRenderer } from './renderer.mjs';
import { sphereIdentityFromPrompt } from './identity.mjs';
import { png } from './png.mjs';

const samples = [
  { name: 'Shooter', prompt: 'Make a fast first-person shooter on an abandoned space station.' },
  { name: 'RPG', prompt: 'Make a fantasy RPG where I explore a forest and discover ancient ruins.' },
  { name: 'Racing', prompt: 'Make a night-time drift racing game through a rainy city.' },
];
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const image = (prompt, size = 384) => {
  const identity = sphereIdentityFromPrompt(prompt);
  const art = createSphereRenderer(identity?.seed ?? 23)({ ...identity, size, variant: identity ? 'chrome' : 'default' });
  return `data:image/png;base64,${png(art.width, art.height, art.data).toString('base64')}`;
};
const sources = samples.map(s => image(s.prompt));
const cards = samples.map((s, i) => {
  const identity = sphereIdentityFromPrompt(s.prompt);
  return `<article class="study" data-study="${i}"><header class="study-heading"><span class="number">0${i + 1}</span><h2>${s.name}</h2></header><div class="stage"><img data-hero="${i}" src="${sources[i]}" width="384" height="384" alt="${s.name}: ${identity.palette.toLowerCase()} sphere"></div><label class="prompt-label" for="prompt-${i}">Game prompt</label><textarea id="prompt-${i}" data-prompt="${i}" rows="4" spellcheck="false">${escape(s.prompt)}</textarea><p class="identity" data-identity="${i}">${identity.palette} · ${identity.detail < .5 ? 'broad' : 'fine'} clouds</p><details><summary>How this one was chosen</summary><p data-mapping="${i}">Seed ${identity.seed}. Cloud detail ${Math.round(identity.detail * 100)}%. Pattern rotation ${Math.round(identity.turn * 180 / Math.PI)}°.</p></details></article>`;
}).join('');
const rows = samples.map((s,i) => `<div class="game-row${i === 0 ? ' selected' : ''}"><img data-row="${i}" src="${sources[i]}" width="28" height="28" alt=""><span>${s.name}</span></div>`).join('');
const fonts = name => readFileSync(new URL(`../../../src/renderer/fonts/${name}`, import.meta.url)).toString('base64');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genex — Different games</title><style>
@font-face{font-family:StudySans;src:url(data:font/woff2;base64,${fonts('ZalandoSansSemiExpanded-variable.woff2')}) format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:StudyMono;src:url(data:font/woff2;base64,${fonts('GeistMono-variable.woff2')}) format('woff2');font-weight:100 900;font-display:swap}
${readFileSync(new URL('styles.css', import.meta.url),'utf8')}
.controls{gap:8px}.controls .label{margin-right:14px;font-size:12px;color:var(--muted)}.controls button[aria-pressed=true]{background:var(--hover);color:var(--ink);border-color:var(--secondary)}.controls #restore{margin-left:auto}.prompt-label{display:block;color:var(--muted);font-size:11px;margin:0 0 8px}textarea{width:100%;min-height:102px;resize:vertical;background:var(--surface);color:var(--secondary);border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.7 StudySans,system-ui,sans-serif}textarea:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.identity{font:11px StudyMono,monospace;color:var(--secondary);margin:14px 0}details{color:var(--muted);font-size:11px}summary{cursor:pointer;width:fit-content}details p{font:10px/1.8 StudyMono,monospace}.context{display:grid;grid-template-columns:320px 1fr;gap:48px;align-items:center;border-top:1px solid var(--line);margin-top:38px;padding-top:30px}.context h2{margin-bottom:12px}.context p{max-width:540px;color:var(--muted);font-size:12px;line-height:1.8}.context .sidebar{width:100%}.context .game-row{cursor:default}.default-row{border-top:1px solid var(--line);margin-top:8px;padding-top:10px}.diagram{font:11px/2 StudyMono,monospace;color:var(--secondary)}.diagram span{color:var(--muted);padding:0 8px}main{padding-bottom:48px}.study-footer{margin-top:28px}.default-preview{font-size:12px;color:var(--muted)}@media(max-width:740px){.context{grid-template-columns:1fr;gap:20px}.context .sidebar{max-width:360px}.controls{gap:8px}.controls .label{flex-basis:100%;margin-bottom:4px}.controls #restore{margin-left:0}.studies{gap:24px}.study+.study{padding-top:22px}}
</style></head><body><main>
<header class="page-header"><div><p class="eyebrow">GENEX <span>/</span> GAME IDENTITIES</p><h1>Three games. Three spheres.</h1><p class="intro">Edit a prompt to see its identity. The material stays the same.</p></div><button id="background" class="quiet-button" type="button" aria-pressed="false">Light background</button></header>
<nav class="controls" aria-label="Shared sphere material"><span class="label">Material for every game</span><button type="button" class="quiet-button" data-material="chrome" aria-pressed="true">Sky + chrome</button><button type="button" class="quiet-button" data-material="pearl" aria-pressed="false">Cloud pearl</button><button type="button" class="quiet-button" data-material="iris" aria-pressed="false">Abstract iris</button><button id="restore" class="text-button" type="button">Restore examples</button></nav>
<section class="studies" aria-label="Game prompt examples">${cards}</section>
<section class="context" aria-label="How it appears in the sidebar"><div class="sidebar"><div class="sidebar-header">Games <span aria-hidden="true">+</span></div>${rows}<div class="game-row default-row"><img src="${image('',112)}" width="28" height="28" alt=""><span>New game</span></div></div><div><h2>One visual family. A stable identity per game.</h2><div class="diagram">First prompt <span>→</span> color + pattern + orientation</div><p>Here, color comes from a hash of the text. It is an identifying mark, not a genre label. Two games can share a color while having different surface patterns.</p><p>For the app, we would save this identity after the first brief. Follow-up messages would keep the same sphere. A game without a brief would use the silver-blue default.</p></div></section>
<footer class="study-footer"><div class="default-preview">Same prompt → same identity. No AI calls.</div><p id="status" role="status" aria-live="polite">Ready · generated locally</p></footer><noscript><p class="notice">Initial examples are visible. Enable JavaScript to edit prompts.</p></noscript>
</main><script>
${createSphereRenderer.toString()}
${sphereIdentityFromPrompt.toString()}
const samples = ${JSON.stringify(samples)};
${readFileSync(new URL('identity-controls.js', import.meta.url),'utf8')}
</script></body></html>`;
const out = new URL('../ag-966-game-identities.html', import.meta.url);
writeFileSync(out,html);
console.log(out.pathname);
console.log(samples.map(s=>({game:s.name,identity:sphereIdentityFromPrompt(s.prompt)})));
