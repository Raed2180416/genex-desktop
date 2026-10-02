import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderLibrarySphere, SPHERE_EXAMPLES, SPHERE_MIXES, validateSphereRecipe, recipeFromBrief } from './index.mjs';
import { png } from '../spheres/png.mjs';

const directory=new URL('../../../.studio-dev/sphere-library/',import.meta.url);
mkdirSync(directory,{recursive:true});
const width=1440,height=720,data=new Uint8ClampedArray(width*height*4);
for(let i=0;i<data.length;i+=4)data.set([24,24,27,255],i);
const timings=[];
function blit(art,left,top,size){
  // Area average for truthful small-size proofs, rather than nearest-neighbor sparkle.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const fromX=Math.floor(x*art.width/size),toX=Math.max(fromX+1,Math.floor((x+1)*art.width/size));
    const fromY=Math.floor(y*art.height/size),toY=Math.max(fromY+1,Math.floor((y+1)*art.height/size));
    let alpha=0,r=0,g=0,b=0,count=0;
    for(let sy=fromY;sy<toY;sy++)for(let sx=fromX;sx<toX;sx++){
      const p=(sy*art.width+sx)*4,a=art.data[p+3]/255;
      alpha+=a;r+=art.data[p]*a;g+=art.data[p+1]*a;b+=art.data[p+2]*a;count++;
    }
    const q=((top+y)*width+left+x)*4;
    data[q]=data[q]*(1-alpha/count)+r/count;data[q+1]=data[q+1]*(1-alpha/count)+g/count;data[q+2]=data[q+2]*(1-alpha/count)+b/count;
  }
}
for(const [index,item] of SPHERE_EXAMPLES.entries()){
  const start=performance.now(),art=renderLibrarySphere(item.recipe,224);
  timings.push({name:item.name,recipe:item.recipe,size:224,renderMs:+(performance.now()-start).toFixed(1)});
  const left=(index%6)*240+8,top=Math.floor(index/6)*360;
  blit(art,left,top,224);blit(art,left+97,top+244,28);blit(art,left+89,top+288,44);
  writeFileSync(new URL(`${index}.png`,directory),png(art.width,art.height,art.data));
}
writeFileSync(new URL('contact-sheet.png',directory),png(width,height,data));
const zero={version:1,seed:0,base:'planets',mix:'none',palette:'ice'};
assert.deepEqual(renderLibrarySphere(zero,64),renderLibrarySphere(zero,64));
assert.notDeepEqual(renderLibrarySphere(zero,64).data,renderLibrarySphere({...zero,seed:1},64).data);
assert.equal(recipeFromBrief('  \n ').base,'cloud-pearl');
assert.deepEqual(recipeFromBrief(' Make a\nshooter. '),recipeFromBrief('Make a shooter.'));
assert.throws(()=>validateSphereRecipe({...zero,base:'rings'}));
assert.throws(()=>validateSphereRecipe({...zero,code:'do something'}));
assert.throws(()=>validateSphereRecipe({...zero,seed:NaN}));
assert.throws(()=>validateSphereRecipe({...zero,mix:null}));
assert.throws(()=>renderLibrarySphere(zero,Infinity));
assert.throws(()=>validateSphereRecipe({...zero,base:'cloud-pearl',mix:'crystal'}));
const samePalette=[];
for(const base of Object.keys(SPHERE_MIXES))samePalette.push(createHash('sha256').update(renderLibrarySphere({...zero,base},64).data).digest('hex'));
assert.equal(new Set(samePalette).size,samePalette.length,'Families must remain different with an identical seed/palette.');
let combinations=0;
for(const [base,mixes] of Object.entries(SPHERE_MIXES))for(const mix of mixes){
  const art=renderLibrarySphere({...zero,base,mix},48);
  assert.equal(art.data.length,48*48*4);assert.ok(art.data.some((v,i)=>i%4===3&&v>0));combinations++;
  if(mix!=='none')assert.notDeepEqual(art.data,renderLibrarySphere({...zero,base,mix:'none'},48).data,`${base}+${mix} must change the rendered image`);
}
const report={node:process.version,profile:'none — offline artifact renderer',provider:'none',seedDeterminism:'pass',unknownFieldsAndRings:'rejected',invalidSize:'rejected',placeholder:'cloud-pearl',samePaletteFamilyDiversity:'pass',supportedCombinations:combinations,timings,browserUI:'unverified — local HTML browser policy blocked earlier in this session'};
writeFileSync(new URL('report.json',directory),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
