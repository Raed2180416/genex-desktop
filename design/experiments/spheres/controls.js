(() => {
  'use strict';
  const ids = ['chrome', 'pearl', 'iris'];
  const choices = ['all', ...ids];
  const names = { chrome: 'Sky + chrome', pearl: 'Cloud pearl', iris: 'Abstract iris' };
  const palettes = [226, 208, 249, 237, 214];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const controls = Object.fromEntries(['seed', 'hue', 'gloss', 'detail'].map(id => [id, $('#' + id)]));
  const status = $('#status');
  const originals = new Map($$('img').map(img => [img, img.src]));
  const cache = new Map();
  let generation = 0, timer, selectedGame = -1;
  function state() {
    const number = id => Number(controls[id].value);
    return { seed: Math.max(1, Math.min(999999, number('seed') || 23)), hue: number('hue'), gloss: number('gloss') / 100, detail: number('detail') / 100 };
  }
  function updateLabels() {
    $('#hue-value').value = controls.hue.value + '°';
    $('#gloss-value').value = controls.gloss.value + '%';
    $('#detail-value').value = controls.detail.value + '%';
  }
  function setVariant(value, write = true) {
    const id = choices.includes(value) ? value : 'all';
    document.body.dataset.variant = id;
    $$('[data-study]').forEach(el => { el.hidden = id !== 'all' && el.dataset.study !== id; });
    $$('[data-variant]').filter(el => el.tagName === 'BUTTON').forEach(el => {
      if (el.dataset.variant === id) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });
    if (write) {
      const url = new URL(location.href); url.searchParams.set('variant', id);
      // Some local-file browsers disallow history changes. The picker still works.
      try { history.replaceState(null, '', url); } catch { /* Local-file policy. */ }
    }
  }
  function yieldFrame() { return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))); }
  async function renderAll() {
    const current = ++generation;
    const settings = state();
    const started = performance.now();
    status.textContent = 'Rendering…';
    await yieldFrame();
    let renders = 0;
    async function image(variant, seed, hue, size) {
      const config = { size, variant, hue, gloss: settings.gloss, detail: settings.detail };
      const key = JSON.stringify([seed, config]);
      if (cache.has(key)) return cache.get(key);
      if (current !== generation) return null;
      const art = createSphereRenderer(seed)(config);
      const canvas = document.createElement('canvas');
      canvas.width = art.width; canvas.height = art.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
      context.putImageData(new ImageData(art.data, art.width, art.height), 0, 0);
      const url = canvas.toDataURL('image/png');
      // Bounded cache. Original previews remain embedded in the document.
      if (cache.size >= 72) cache.delete(cache.keys().next().value);
      cache.set(key, url); renders++;
      await yieldFrame();
      return url;
    }
    try {
      for (const variant of ids) {
        const seed = settings.seed + (selectedGame < 0 ? 0 : selectedGame * 107);
        const hue = selectedGame < 0 ? settings.hue : Math.max(195, Math.min(275, settings.hue + palettes[selectedGame] - 226));
        const hero = await image(variant, seed, hue, 480);
        if (current !== generation) return;
        $(`[data-hero="${variant}"]`).src = hero;
        $(`[data-save="${variant}"]`).dataset.renderedSeed = seed;
        $$(`[data-small="${variant}"]`).forEach(el => { el.src = hero; });
        for (let i = 0; i < 5; i++) {
          const row = await image(variant, settings.seed + i * 107, Math.max(195, Math.min(275, settings.hue + palettes[i] - 226)), 112);
          if (current !== generation) return;
          $(`[data-art="${variant}-${i}"]`).src = row;
        }
      }
      status.textContent = `Seed ${settings.seed} · ${renders ? Math.round(performance.now() - started) + ' ms' : 'cached'} · local`;
    } catch (error) {
      status.textContent = 'Could not update the previews. Reset restores the originals.';
      console.error(error);
    }
  }
  function scheduleRender() {
    updateLabels();
    ++generation; // Cancel any in-flight render before it can overwrite newer settings.
    clearTimeout(timer);
    timer = setTimeout(renderAll, 140);
  }
  Object.values(controls).forEach(input => input.addEventListener('input', scheduleRender));
  $('#shuffle').addEventListener('click', () => {
    controls.seed.value = Math.floor(Math.random() * 999998) + 1;
    scheduleRender();
  });
  $('#reset').addEventListener('click', () => {
    ++generation; clearTimeout(timer);
    controls.seed.value = 23; controls.hue.value = 226; controls.gloss.value = 70; controls.detail.value = 55;
    selectedGame = -1;
    originals.forEach((src, img) => { img.src = src; });
    $$('[data-save]').forEach(button => { button.dataset.renderedSeed = '23'; });
    $$('.game-row').forEach(row => {
      const active = row.dataset.game === '0';
      row.classList.toggle('selected', active); row.setAttribute('aria-pressed', String(active));
    });
    updateLabels(); status.textContent = 'Ready · generated locally';
  });
  $('#background').addEventListener('click', event => {
    const light = document.body.classList.toggle('light');
    event.currentTarget.setAttribute('aria-pressed', String(light));
    event.currentTarget.textContent = light ? 'Dark background' : 'Light background';
  });
  $$('.game-row').forEach(row => row.addEventListener('click', () => {
    selectedGame = Number(row.dataset.game);
    $$('.game-row').forEach(el => {
      const active = Number(el.dataset.game) === selectedGame;
      el.classList.toggle('selected', active); el.setAttribute('aria-pressed', String(active));
    });
    scheduleRender();
  }));
  $$('[data-save]').forEach(button => button.addEventListener('click', () => {
    const variant = button.dataset.save;
    const link = document.createElement('a');
    link.href = $(`[data-hero="${variant}"]`).src;
    link.download = `genex-${variant}-seed-${button.dataset.renderedSeed}.png`;
    document.body.append(link); link.click(); link.remove();
    status.textContent = `${names[variant]} PNG requested`;
  }));
  $$('.variant-picker button').forEach(button => button.addEventListener('click', () => setVariant(button.dataset.variant)));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    if (!['ArrowLeft', 'ArrowRight', '1', '2', '3', '4'].includes(event.key)) return;
    const active = choices.indexOf(document.body.dataset.variant);
    const next = /^\d$/.test(event.key) ? Number(event.key) - 1 : (active + (event.key === 'ArrowRight' ? 1 : choices.length - 1)) % choices.length;
    event.preventDefault(); setVariant(choices[next]);
  });
  window.addEventListener('popstate', () => setVariant(new URL(location.href).searchParams.get('variant'), false));
  setVariant(new URL(location.href).searchParams.get('variant'), false);
})();
