(() => {
  const $ = q => document.querySelector(q), $$ = q => [...document.querySelectorAll(q)];
  let material = 'chrome', generation = 0, timer;
  const originals = $$('[data-hero]').map(img => img.src);
  const status = $('#status');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  function describe(i, identity) {
    $(`[data-identity="${i}"]`).textContent = identity ? `${identity.palette} · ${identity.detail < .5 ? 'broad' : 'fine'} clouds` : 'Default · no brief yet';
    $(`[data-mapping="${i}"]`).textContent = identity ? `Seed ${identity.seed}. Cloud detail ${Math.round(identity.detail * 100)}%. Pattern rotation ${Math.round(identity.turn * 180 / Math.PI)}°.` : 'No prompt, so no game identity has been assigned.';
  }
  async function render() {
    const token = ++generation, start = performance.now();
    status.textContent = 'Rendering…';
    await frame();
    try {
      for (let i = 0; i < samples.length; i++) {
        if (token !== generation) return;
        const identity = sphereIdentityFromPrompt($(`[data-prompt="${i}"]`).value);
        const art = createSphereRenderer(identity?.seed ?? 23)({ ...identity, variant: identity ? material : 'default', size: 384 });
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = art.width;
        const context = canvas.getContext('2d');
        if (!context) throw Error('Canvas is unavailable');
        context.putImageData(new ImageData(art.data, art.width, art.height), 0, 0);
        const url = canvas.toDataURL('image/png');
        $(`[data-hero="${i}"]`).src = url;
        $(`[data-hero="${i}"]`).alt = identity ? `${samples[i].name}: ${identity.palette.toLowerCase()} sphere` : 'Neutral default sphere';
        $(`[data-row="${i}"]`).src = url;
        describe(i,identity);
        await frame();
      }
      if (token === generation) status.textContent = `${Math.round(performance.now()-start)} ms · local`;
    } catch (error) {
      status.textContent = 'Could not render. Restore examples returns to the original previews.';
      console.error(error);
    }
  }
  function schedule() { ++generation; clearTimeout(timer); timer = setTimeout(render, 280); }
  $$('[data-prompt]').forEach(input => input.addEventListener('input',schedule));
  $$('[data-material]').forEach(button => button.addEventListener('click',() => {
    material = button.dataset.material;
    $$('[data-material]').forEach(el => el.setAttribute('aria-pressed',String(el===button)));
    schedule();
  }));
  $('#background').addEventListener('click',event => {
    const light=document.body.classList.toggle('light');
    event.currentTarget.textContent=light?'Dark background':'Light background';
    event.currentTarget.setAttribute('aria-pressed',String(light));
  });
  $('#restore').addEventListener('click',() => {
    ++generation; clearTimeout(timer); material='chrome';
    $$('[data-material]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.material===material)));
    samples.forEach((s,i)=>{
      $(`[data-prompt="${i}"]`).value=s.prompt;
      $(`[data-hero="${i}"]`).src=originals[i]; $(`[data-row="${i}"]`).src=originals[i];
      const identity=sphereIdentityFromPrompt(s.prompt);
      $(`[data-hero="${i}"]`).alt=`${s.name}: ${identity.palette.toLowerCase()} sphere`;
      describe(i,identity);
    });
    status.textContent='Ready · generated locally';
  });
})();
