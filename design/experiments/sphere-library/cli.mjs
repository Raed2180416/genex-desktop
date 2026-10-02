import { readFileSync, writeFileSync } from 'node:fs';
import { renderLibrarySphere, validateSphereRecipe, recipeFromBrief } from './index.mjs';
import { png } from '../spheres/png.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || !args.length) {
  console.log('Usage: node cli.mjs --recipe recipe.json --out cover.png [--size 256]\n       node cli.mjs --brief "game idea" --out cover.png [--base crystal --mix clouds --palette ice]\nOutput must not already exist. The renderer runs locally without network or model calls.');
  process.exit(0);
}
try {
  const allowed = new Set(['--recipe','--brief','--out','--size','--base','--mix','--palette']);
  const values = {};
  for(let i=0;i<args.length;i+=2){
    if(!allowed.has(args[i])||args[i+1]===undefined||Object.hasOwn(values,args[i]))throw Error(`Invalid argument: ${args[i]}`);
    values[args[i]]=args[i+1];
  }
  if(!values['--out'])throw Error('Provide --out cover.png.');
  if(Object.hasOwn(values,'--recipe')===Object.hasOwn(values,'--brief'))throw Error('Provide exactly one of --recipe or --brief.');
  if(values['--recipe']&&['--base','--mix','--palette'].some(k=>values[k]))throw Error('Put visual choices in the recipe when using --recipe.');
  const recipe=values['--recipe'] ? validateSphereRecipe(JSON.parse(readFileSync(values['--recipe'],'utf8'))) : recipeFromBrief(values['--brief'],Object.fromEntries(['base','mix','palette'].filter(k=>values['--'+k]).map(k=>[k,values['--'+k]])));
  const start=performance.now();
  const art=renderLibrarySphere(recipe,values['--size']===undefined?256:Number(values['--size']));
  writeFileSync(values['--out'],png(art.width,art.height,art.data),{flag:'wx'});
  console.log(JSON.stringify({out:values['--out'],size:art.width,renderAndEncodeMs:Math.round(performance.now()-start),recipe}));
} catch(error){console.error(error.message);process.exitCode=1;}
