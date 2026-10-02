(() => {
  const {renderLibrarySphere,validateSphereRecipe,recipeFromBrief,SPHERE_MIXES,SPHERE_EXAMPLES}=SphereLibrary;
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const names={planets:'Planetary system',ribbons:'Liquid ribbons',crystal:'Crystal core',eclipse:'Eclipse',fragments:'Fragments','cloud-pearl':'Cloud pearl'};
  const status=$('#status'),hero=$('#hero');
  let recipe=SPHERE_EXAMPLES[0].recipe,renderedRecipe=recipe,generation=0,timer,oneColor=false,catalogGeneration=0;
  const originals=new Map($$('[data-example]').map(button=>[Number(button.dataset.example),button.querySelector('img').src]));
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  function image(input,size){
    const art=renderLibrarySphere(input,size),canvas=document.createElement('canvas');canvas.width=canvas.height=art.width;
    const context=canvas.getContext('2d');if(!context)throw Error('Canvas rendering is unavailable.');
    context.putImageData(new ImageData(art.data,art.width,art.height),0,0);return canvas.toDataURL('image/png');
  }
  function updateMixes(){
    const previous=$('#mix').value,base=$('#base').value;
    $('#mix').replaceChildren(...SPHERE_MIXES[base].map(value=>{const option=document.createElement('option');option.value=value;option.textContent=value==='none'?'Nothing':value[0].toUpperCase()+value.slice(1);return option;}));
    $('#mix').value=SPHERE_MIXES[base].includes(previous)?previous:'none';$('#mix').disabled=base==='cloud-pearl';
  }
  function showRecipe(){ $('#recipe').textContent=JSON.stringify(recipe,null,2); }
  function setControls(value){
    recipe=validateSphereRecipe(value);$('#base').value=recipe.base;updateMixes();$('#mix').value=recipe.mix;$('#palette').value=recipe.palette;$('#seed').value=recipe.seed;showRecipe();
  }
  async function render(){
    const token=++generation,snapshot={...recipe},start=performance.now();status.textContent='Rendering…';await frame();
    if(token!==generation)return;
    try{
      const url=image(snapshot,416);if(token!==generation)return;
      hero.src=url;hero.alt=`${names[snapshot.base]}${snapshot.mix==='none'?'':` with ${snapshot.mix}`} inside a glass sphere`;
      $('#row-image').src=url;$('#row-name').textContent=names[snapshot.base]+(snapshot.mix==='none'?'':` + ${snapshot.mix}`);renderedRecipe=snapshot;
      status.textContent=`${Math.round(performance.now()-start)} ms · local`;
    }catch(error){status.textContent=error.message;}
  }
  function schedule(){++generation;clearTimeout(timer);timer=setTimeout(render,120);}
  function changed(){
    try{
      if(!$('#seed').validity.valid)throw Error('Enter a seed from 0 to 4294967295.');
      recipe=validateSphereRecipe({version:1,base:$('#base').value,mix:$('#mix').value,palette:$('#palette').value,seed:Number($('#seed').value)});
      showRecipe();$$('[data-example]').forEach(el=>el.setAttribute('aria-pressed','false'));schedule();
    }catch(error){++generation;clearTimeout(timer);status.textContent=error.message;}
  }
  $('#mixer').addEventListener('submit',event=>event.preventDefault());
  $('#base').addEventListener('change',()=>{updateMixes();changed();});
  ['mix','palette'].forEach(id=>$('#'+id).addEventListener('change',changed));$('#seed').addEventListener('input',changed);
  $('#new-seed').addEventListener('click',()=>{$('#seed').value=Math.floor(Math.random()*4294967296);changed();});
  $$('[data-example]').forEach(button=>button.addEventListener('click',()=>{
    const i=Number(button.dataset.example);setControls({...SPHERE_EXAMPLES[i].recipe,...(oneColor?{palette:'ice'}:{})});
    $$('[data-example]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));schedule();
  }));
  $('#copy-recipe').addEventListener('click',async()=>{
    const text=JSON.stringify(recipe);
    try{await navigator.clipboard.writeText(text);status.textContent='Recipe copied.';}
    catch{const selection=window.getSelection(),range=document.createRange();range.selectNodeContents($('#recipe'));selection.removeAllRanges();selection.addRange(range);$('#recipe').focus();status.textContent='Recipe selected. Press ⌘C / Ctrl+C to copy.';}
  });
  $('#save-png').addEventListener('click',()=>{
    const link=document.createElement('a');link.href=hero.src;link.download=`sphere-${renderedRecipe.base}-${renderedRecipe.mix}-${renderedRecipe.seed}.png`;document.body.append(link);link.click();link.remove();
  });
  $('#from-brief').addEventListener('click',()=>{setControls(recipeFromBrief($('#brief').value));$$('[data-example]').forEach(el=>el.setAttribute('aria-pressed','false'));schedule();});
  $('#background').addEventListener('click',event=>{const light=document.body.classList.toggle('light');event.currentTarget.textContent=light?'Dark background':'Light background';event.currentTarget.setAttribute('aria-pressed',String(light));});
  $('#one-color').addEventListener('click',async event=>{
    oneColor=!oneColor;event.currentTarget.setAttribute('aria-pressed',String(oneColor));event.currentTarget.textContent=oneColor?'Restore palette variety':'Compare in one color';
    const token=++catalogGeneration;await frame();
    for(const button of $$('[data-example]')){
      if(token!==catalogGeneration)return;
      const index=Number(button.dataset.example);
      try{const url=oneColor?image({...SPHERE_EXAMPLES[index].recipe,palette:'ice'},224):originals.get(index);button.querySelectorAll('img').forEach(img=>img.src=url);}catch(error){status.textContent=error.message;return;}
      await frame();
    }
  });
  setControls(recipe);
})();
