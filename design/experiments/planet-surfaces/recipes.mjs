/** Surface recipes v2. The rejected v1 interior-scene recipes are deliberately incompatible. */
export const PALETTES={ice:[.055,.32,.66],violet:[.35,.12,.62],jade:[.045,.42,.31],amber:[.62,.30,.07],rose:[.61,.10,.27],silver:[.42,.49,.61]};
export const LAYERS={ocean:['none','clouds','frost'],craters:['none','frost','metallic'],bands:['none','storms','clouds'],marble:['none','veins','metallic'],'cloud-pearl':['none']};
export const SURFACES=Object.keys(LAYERS);
export function validateRecipe(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Recipe must be a JSON object.');
  const keys=new Set(['version','seed','surface','layer','palette']);
  for(const key of Object.keys(value))if(!keys.has(key))throw Error(`Unknown recipe field: ${key}`);
  if(value.version!==2)throw Error('Surface recipe version must be 2.');
  if(!Number.isInteger(value.seed)||value.seed<0||value.seed>0xffffffff)throw Error('Seed must be an unsigned 32-bit integer.');
  if(!SURFACES.includes(value.surface))throw Error('Choose an available surface.');
  if(!Object.hasOwn(PALETTES,value.palette))throw Error('Choose an available palette.');
  const layer=Object.hasOwn(value,'layer')?value.layer:'none';
  if(!LAYERS[value.surface].includes(layer))throw Error(`Layer ${layer} is not supported on ${value.surface}.`);
  return {version:2,seed:value.seed,surface:value.surface,layer,palette:value.palette};
}
export function recipeFromBrief(brief,choices={}){
  if(typeof brief!=='string')throw Error('Brief must be text.');
  const text=brief.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!text)return {version:2,seed:23,surface:'cloud-pearl',layer:'none',palette:'ice'};
  let seed=2166136261;for(const char of text)seed=Math.imul(seed^char.codePointAt(0),16777619)>>>0;
  const candidates=SURFACES.filter(surface=>surface!=='cloud-pearl');
  const surface=choices.surface??candidates[seed%candidates.length];
  if(!SURFACES.includes(surface))throw Error('Unsupported surface.');
  return validateRecipe({version:2,seed,surface,layer:choices.layer??LAYERS[surface][(seed>>>11)%LAYERS[surface].length],palette:choices.palette??Object.keys(PALETTES)[(seed>>>18)%6]});
}
export const EXAMPLES=[
  {name:'Океаны и материки',recipe:{version:2,seed:127,surface:'ocean',layer:'none',palette:'ice'}},
  {name:'Кратеры',recipe:{version:2,seed:482,surface:'craters',layer:'none',palette:'silver'}},
  {name:'Газовые полосы',recipe:{version:2,seed:329,surface:'bands',layer:'none',palette:'amber'}},
  {name:'Жидкий мрамор',recipe:{version:2,seed:713,surface:'marble',layer:'none',palette:'violet'}},
  {name:'Cloud pearl · плейсхолдер',recipe:{version:2,seed:23,surface:'cloud-pearl',layer:'none',palette:'ice'}},
  {name:'Материки + облака',recipe:{version:2,seed:127,surface:'ocean',layer:'clouds',palette:'ice'}},
  {name:'Кратеры + иней',recipe:{version:2,seed:482,surface:'craters',layer:'frost',palette:'silver'}},
  {name:'Полосы + вихри',recipe:{version:2,seed:329,surface:'bands',layer:'storms',palette:'amber'}},
  {name:'Мрамор + металл',recipe:{version:2,seed:713,surface:'marble',layer:'metallic',palette:'violet'}},
];
