(() => {
  const {renderPlanet,validateRecipe,recipeFromBrief,LAYERS,EXAMPLES}=PlanetSurfaces;
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const names={ocean:'Океаны и материки',craters:'Кратеры',bands:'Газовые полосы',marble:'Жидкий мрамор','cloud-pearl':'Cloud pearl'};
  const layerNames={none:'Без слоя',clouds:'Облака',frost:'Иней',metallic:'Металл',storms:'Вихри',veins:'Прожилки'};
  const status=$('#status'),hero=$('#hero');
  let recipe=EXAMPLES[0].recipe,renderedRecipe=recipe,generation=0,timer,oneColor=false,catalogGeneration=0;
  const originals=new Map($$('[data-example]').map(button=>[Number(button.dataset.example),button.querySelector('img').src]));
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  function image(input,size){
    const art=renderPlanet(input,size),canvas=document.createElement('canvas');canvas.width=canvas.height=art.width;
    const context=canvas.getContext('2d');if(!context)throw Error('Canvas rendering is unavailable.');
    context.putImageData(new ImageData(art.data,art.width,art.height),0,0);return canvas.toDataURL('image/png');
  }
  function updateLayers(){
    const previous=$('#layer').value,surface=$('#surface').value;
    $('#layer').replaceChildren(...LAYERS[surface].map(value=>{const option=document.createElement('option');option.value=value;option.textContent=layerNames[value];return option;}));
    $('#layer').value=LAYERS[surface].includes(previous)?previous:'none';$('#layer').disabled=surface==='cloud-pearl';
  }
  function showRecipe(){ $('#recipe').textContent=JSON.stringify(recipe,null,2); }
  function setControls(value){
    recipe=validateRecipe(value);$('#surface').value=recipe.surface;updateLayers();$('#layer').value=recipe.layer;$('#palette').value=recipe.palette;$('#seed').value=recipe.seed;showRecipe();
  }
  async function render(){
    const token=++generation,snapshot={...recipe},start=performance.now();status.textContent='Рендер…';await frame();
    if(token!==generation)return;
    try{
      const url=image(snapshot,416);if(token!==generation)return;
      hero.src=url;hero.alt=`${names[snapshot.surface]}${snapshot.layer==='none'?'':` + ${layerNames[snapshot.layer]}`} — поверхность планеты`;
      $('#row-image').src=url;$('#row-name').textContent=names[snapshot.surface]+(snapshot.layer==='none'?'':` + ${layerNames[snapshot.layer]}`);renderedRecipe=snapshot;
      status.textContent=`${Math.round(performance.now()-start)} мс · локально`;
    }catch(error){status.textContent=error.message;}
  }
  function schedule(){++generation;clearTimeout(timer);timer=setTimeout(render,120);}
  function changed(){
    try{
      if(!$('#seed').validity.valid)throw Error('Введите seed от 0 до 4294967295.');
      recipe=validateRecipe({version:2,surface:$('#surface').value,layer:$('#layer').value,palette:$('#palette').value,seed:Number($('#seed').value)});
      showRecipe();$$('[data-example]').forEach(el=>el.setAttribute('aria-pressed','false'));schedule();
    }catch(error){++generation;clearTimeout(timer);status.textContent=error.message;}
  }
  $('#mixer').addEventListener('submit',event=>event.preventDefault());
  $('#surface').addEventListener('change',()=>{updateLayers();changed();});
  ['layer','palette'].forEach(id=>$('#'+id).addEventListener('change',changed));$('#seed').addEventListener('input',changed);
  $('#new-seed').addEventListener('click',()=>{$('#seed').value=Math.floor(Math.random()*4294967296);changed();});
  $$('[data-example]').forEach(button=>button.addEventListener('click',()=>{
    const i=Number(button.dataset.example);setControls({...EXAMPLES[i].recipe,...(oneColor?{palette:'ice'}:{})});
    $$('[data-example]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));schedule();
  }));
  $('#copy-recipe').addEventListener('click',async()=>{
    const text=JSON.stringify(recipe);
    try{await navigator.clipboard.writeText(text);status.textContent='Рецепт скопирован.';}
    catch{const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('#recipe'));selection.removeAllRanges();selection.addRange(range);$('#recipe').focus();status.textContent='Рецепт выделен. Нажмите ⌘C / Ctrl+C.';}
  });
  $('#save-png').addEventListener('click',()=>{
    const link=document.createElement('a');link.href=hero.src;link.download=`planet-${renderedRecipe.surface}-${renderedRecipe.layer}-${renderedRecipe.seed}.png`;document.body.append(link);link.click();link.remove();
  });
  $('#from-brief').addEventListener('click',()=>{setControls(recipeFromBrief($('#brief').value));$$('[data-example]').forEach(el=>el.setAttribute('aria-pressed','false'));schedule();});
  $('#background').addEventListener('click',event=>{const light=document.body.classList.toggle('light');event.currentTarget.textContent=light?'Тёмный фон':'Светлый фон';event.currentTarget.setAttribute('aria-pressed',String(light));});
  $('#one-color').addEventListener('click',async event=>{
    oneColor=!oneColor;event.currentTarget.setAttribute('aria-pressed',String(oneColor));event.currentTarget.textContent=oneColor?'Вернуть разные цвета':'Сравнить в одном цвете';
    const token=++catalogGeneration;await frame();
    for(const button of $$('[data-example]')){
      if(token!==catalogGeneration)return;
      const index=Number(button.dataset.example);
      try{const url=oneColor?image({...EXAMPLES[index].recipe,palette:'ice'},224):originals.get(index);button.querySelectorAll('img').forEach(img=>img.src=url);}catch(error){status.textContent=error.message;return;}
      await frame();
    }
  });
  setControls(recipe);
})();
