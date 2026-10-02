import { validateSphereRecipe, SPHERE_PALETTES } from './recipes.mjs';
import { createSphereRenderer } from '../spheres/renderer.mjs';

/** Deterministic CPU ray renderer. Inputs are bounded JSON; output is RGBA, no side effects. */
export function renderLibrarySphere(input, size = 320) {
  const recipe = validateSphereRecipe(input);
  if (!Number.isInteger(size) || size < 28 || size > 768) throw Error('Image size must be an integer from 28 to 768.');
  if (recipe.base === 'cloud-pearl') return createSphereRenderer(recipe.seed)({ size, variant: 'pearl', hue: 226, color: recipe.palette === 'ice' ? undefined : SPHERE_PALETTES[recipe.palette], gloss: .7 });
  let state = recipe.seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const clamp = v => Math.max(0, Math.min(1, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normal = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
  const palette = SPHERE_PALETTES[recipe.palette];
  const pale = palette.map(c => mix(c, 1, .75));
  const second = { ice: [.60,.78,.92], violet: [.90,.54,.69], jade: [.55,.88,.75], amber: [.96,.68,.35], rose: [.74,.50,.88], silver: [.47,.72,.88] }[recipe.palette];
  const light = normal([-.65, .8, 1]);
  const noiseTable = Float32Array.from({ length: 4096 }, random);
  const noiseOffset = random() * 90;
  function noise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const h = (a, b, c) => noiseTable[((Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0) & 4095];
    return mix(mix(mix(h(ix, iy, iz), h(ix + 1, iy, iz), fx), mix(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), fx), fy),
      mix(mix(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), fx), mix(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), fx), fy), fz);
  }
  function fbm(x, y, z) {
    return noise(x, y, z) * .6 + noise(x * 2.1 + 7, y * 2.1, z * 2.1) * .27 + noise(x * 4.3, y * 4.3 + 8, z * 4.3) * .13;
  }
  const objects = [];
  function sphere(center, radius, material, color = palette) { objects.push({ shape: 'sphere', center, radius, material, color }); }
  function triangle(a, b, c, material, color, normals) {
    const e1 = sub(b, a), e2 = sub(c, a);
    objects.push({ shape: 'triangle', a, e1, e2, normal: normal(cross(e1, e2)), normals, material, color });
  }
  function rotate(v, rx, ry, rz) {
    let [x, y, z] = v;
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    return [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz), z];
  }
  function crystal(center, width, height, angle, color, tilt = .2) {
    const transform = v => rotate(v, tilt, .35 + angle, angle).map((c, i) => c + center[i]);
    const top = transform([0, height * .58, 0]), bottom = transform([0, -height * .58, 0]);
    const high = [], low = [];
    for (let j = 0; j < 6; j++) {
      const a = j / 6 * Math.PI * 2;
      high.push(transform([Math.cos(a) * width, height * .27, Math.sin(a) * width]));
      low.push(transform([Math.cos(a) * width * .85, -height * .32, Math.sin(a) * width * .85]));
    }
    for (let j = 0; j < 6; j++) {
      const k = (j + 1) % 6;
      const tint = color.map(c => c * (.82 + .18 * (j % 2)));
      triangle(top, high[j], high[k], 'crystal', tint);
      triangle(high[j], low[j], low[k], 'crystal', tint);
      triangle(high[j], low[k], high[k], 'crystal', tint);
      triangle(bottom, low[k], low[j], 'crystal', tint);
    }
  }
  function shard(center, scale, color) {
    const angle = random() * 6.28;
    const verts = [[0,.95,0],[-.58,-.10,0],[.57,-.10,0],[0,-.65,0],[0,-.10,.45],[0,-.10,-.45]].map(v => rotate(v.map(c => c * scale), angle, angle * .7, angle * .6).map((c,i)=>c+center[i]));
    for (const [a,b,c] of [[0,1,4],[0,4,2],[3,4,1],[3,2,4],[0,5,1],[0,2,5],[3,1,5],[3,5,2]]) triangle(verts[a], verts[b], verts[c], 'crystal', color);
  }
  function fragments(count, secondary = false) {
    for (let i = 0; i < count; i++) {
      const angle = (i + .18 + random() * .2) / count * Math.PI * 2;
      const distance = secondary ? .48 + random() * .10 : .25 + random() * .18;
      const center = [Math.cos(angle) * distance, Math.sin(angle) * distance, random() * .35 - .20];
      shard(center, secondary ? .10 + random() * .04 : .17 + random() * .09, i % 2 ? pale : palette);
    }
  }
  function ribbons(count, secondary = false) {
    const globalAngle = (random() - .5) * 1.4;
    for (let ribbon = 0; ribbon < count; ribbon++) {
      const phase = random() * 2.6 + ribbon * 1.8;
      const scale = secondary ? .70 : .92;
      const zOffset = secondary ? -.30 : (ribbon - 1) * .19;
      const width = secondary ? .075 : .105 + random() * .06;
      const color = ribbon % 2 ? second : palette;
      function point(t, sign) {
        const taper = .33 + .67 * Math.pow(Math.max(0, 1 - t * t), .45);
        const x = Math.sin(t * 2.7 + phase) * .31 + (ribbon - (count - 1) / 2) * .15;
        const y = t * .68;
        const z = Math.cos(t * 2.8 + phase) * .18 + zOffset;
        const roll = t * 2.8 + phase;
        return rotate([(x + sign * width * taper * Math.cos(roll)) * scale, y * scale, (z + sign * width * taper * Math.sin(roll)) * scale], 0, 0, globalAngle);
      }
      let previous, previousNormals;
      for (let i = 0; i <= 26; i++) {
        const t = i / 26 * 2 - 1;
        const pair = [-1,1].map(sign=>point(t,sign));
        const edge = sub(pair[1],pair[0]);
        const normals = [-1,1].map(sign=>normal(cross(sub(point(t+.001,sign),point(t-.001,sign)),edge)));
        if (previous) {
          triangle(previous[0], previous[1], pair[0], 'ribbon', color, [previousNormals[0],previousNormals[1],normals[0]]);
          triangle(previous[1], pair[1], pair[0], 'ribbon', color, [previousNormals[1],normals[1],normals[0]]);
        }
        previous = pair;
        previousNormals = normals;
      }
    }
  }
  const sceneAngle = (random() - .5) * .9;
  let emitter = null;
  if (recipe.base === 'planets') {
    const center = rotate([-.12, -.07, -.04], 0, 0, sceneAngle);
    sphere(center, .38 + random() * .045, 'planet');
    sphere(rotate([.39,.32,.04],0,0,sceneAngle), .125 + random() * .035, 'moon', second);
    sphere(rotate([-.39,.37,-.13],0,0,sceneAngle), .056, 'moon', pale);
  } else if (recipe.base === 'ribbons') {
    ribbons(3);
  } else if (recipe.base === 'crystal') {
    crystal([-.06, .03, -.05], .19, 1.0, -.24 + sceneAngle, palette);
    crystal([.29,-.13,.04], .12, .62, -.65 + sceneAngle, pale);
    crystal([-.29,-.2,-.08], .09, .48, .35 + sceneAngle, second);
  } else if (recipe.base === 'eclipse') {
    const phase = random() * 6.28;
    const dx = Math.cos(phase), dy = Math.sin(phase);
    emitter = [dx * -.16, dy * -.16, -.23];
    sphere(emitter, .44, 'emission', pale);
    sphere([dx * .09, dy * .09, .14], .43 + random() * .025, 'obsidian', palette);
  } else fragments(5);

  if (recipe.mix === 'moon') sphere([.33,.29,.20],.145,'moon',pale);
  if (recipe.mix === 'fragments') fragments(3,true);
  if (recipe.mix === 'crystal') crystal([.34,-.27,.06],.12,.49,-.62,pale);
  if (recipe.mix === 'ribbons') ribbons(1,true);

  function intersect(object, o, d, maxT) {
    if (object.shape === 'sphere') {
      const x = o[0] - object.center[0], y = o[1] - object.center[1], z = o[2] - object.center[2];
      const b = x*d[0]+y*d[1]+z*d[2], c = x*x+y*y+z*z-object.radius*object.radius;
      const discriminant = b*b-c;
      if (discriminant < 0) return null;
      const t = -b-Math.sqrt(discriminant);
      if (t <= .0001 || t >= maxT) return null;
      return { t, n: [(x+t*d[0])/object.radius,(y+t*d[1])/object.radius,(z+t*d[2])/object.radius] };
    }
    const p = cross(d,object.e2), determinant = dot(object.e1,p);
    if (Math.abs(determinant) < .000001) return null;
    const inv = 1/determinant, s = sub(o,object.a), u=dot(s,p)*inv;
    if(u<0||u>1)return null;
    const q=cross(s,object.e1),v=dot(d,q)*inv;
    if(v<0||u+v>1)return null;
    const t=dot(object.e2,q)*inv;
    if(t<=.0001||t>=maxT)return null;
    let n=object.normals ? normal(object.normals[0].map((c,i)=>c*(1-u-v)+object.normals[1][i]*u+object.normals[2][i]*v)) : object.normal;
    if(dot(n,d)>0)n=n.map(c=>-c);
    return {t,n};
  }
  function shade(object, hit, o, d) {
    const n = hit.n, position = o.map((c,i)=>c+d[i]*hit.t);
    const diffuse = Math.max(0,dot(n,light));
    const half = normal([light[0]-d[0],light[1]-d[1],light[2]-d[2]]);
    const facing = Math.max(0,-dot(n,d));
    const specular = Math.pow(Math.max(0,dot(n,half)),object.material==='ribbon'?65:110);
    let color=object.color;
    if(object.material==='emission')return color.map(c=>mix(c,1,.85));
    if(object.material==='planet'){
      const value=fbm(n[0]*4.2+noiseOffset,n[1]*4.2,n[2]*4.2);
      const land=smooth(.42,.60,value);
      color=color.map((c,k)=>mix(c*.48,second[k],land*.72));
      if(recipe.mix==='clouds'){
        const cloud=smooth(.57,.76,fbm(n[0]*7+11,n[1]*7+noiseOffset,n[2]*7));
        color=color.map((c,k)=>mix(c,pale[k],cloud*.85));
      }
      const edge=Math.pow(1-facing,3)*.23;
      return color.map((c,k)=>c*(.15+.85*diffuse)+pale[k]*edge+specular*.18);
    }
    if(object.material==='moon'){
      const value=fbm(n[0]*9+noiseOffset,n[1]*9,n[2]*9);
      return color.map(c=>c*(.20+.80*diffuse)*(.70+.30*value)+specular*.15);
    }
    if(object.material==='obsidian'){
      const edge=Math.pow(1-facing,5);
      return color.map(c=>.012+c*.033+c*edge*.20+specular*.025);
    }
    if(object.material==='crystal'){
      const edge=Math.pow(1-facing,2);
      const stripe=.5+.5*Math.cos(position[1]*19+position[0]*8);
      return color.map((c,k)=>c*(.24+.78*diffuse)+pale[k]*edge*.34+specular*.58+stripe*.025);
    }
    // Smooth, reflective liquid-metal bands. Their twists create the highlights.
    const rim=Math.pow(1-facing,3);
    return color.map((c,k)=>c*(.21+.79*diffuse)+pale[k]*rim*.34+specular*.70);
  }
  const data = new Uint8ClampedArray(size*size*4);
  const radius=.88, aa=2.5/size;
  for(let py=0;py<size;py++)for(let px=0;px<size;px++){
    const x=(2*(px+.5)/size-1)/radius,y=(1-2*(py+.5)/size)/radius,r2=x*x+y*y;
    if(r2>=1)continue;
    const z=Math.sqrt(1-r2),r=Math.sqrt(r2);
    // Analytic refraction through the front surface of the shared glass container.
    const eta=.88, bend=eta*z-Math.sqrt(1-eta*eta*(1-z*z));
    const d=[bend*x,bend*y,-eta+bend*z],o=[x+d[0]*.0001,y+d[1]*.0001,z+d[2]*.0001];
    const glow=Math.exp(-((x+.16)**2+(y+.26)**2)/.40);
    let color=palette.map(c=>.017+c*(.030+.075*glow));
    if(emitter){
      const dist=Math.hypot(x-emitter[0],y-emitter[1]);
      const corona=Math.exp(-(((dist-.46)/.105)**2))*.35;
      color=color.map((c,k)=>c+pale[k]*corona);
    }
    if(recipe.mix==='clouds'&&recipe.base!=='planets'){
      const clouds=smooth(.38,.70,fbm(x*2.4+noiseOffset,y*2.4,z*2.4));
      color=color.map((c,k)=>c+pale[k]*clouds*.11);
    }
    let nearest=3,hitObject=null,hitInfo=null;
    for(const object of objects){const hit=intersect(object,o,d,nearest);if(hit){nearest=hit.t;hitObject=object;hitInfo=hit;}}
    if(hitObject)color=shade(hitObject,hitInfo,o,d);
    // Thin, restrained shared shell; no mirrored lower hemisphere or orbital ring.
    const fresnel=Math.pow(1-z,3.8),rx=2*x*z,ry=2*y*z,rz=2*z*z-1;
    const highlight=Math.exp(-(((rx+.47)/.20)**2+((ry-.62)/.11)**2))*smooth(.10,.55,rz)*.22;
    const arc=Math.exp(-(((r-.976)/.017)**2))*(.11+.14*Math.max(0,y-x));
    const side=Math.exp(-(((rx-.94)/.035)**2+((ry+.03)/.55)**2))*.055;
    const index=(py*size+px)*4;
    for(let k=0;k<3;k++){
      const value=color[k]*(1-fresnel*.32)+pale[k]*(fresnel*.12+arc)+highlight+side;
      data[index+k]=Math.round(clamp(value)*255);
    }
    data[index+3]=Math.round(smooth(0,aa,1-r)*255);
  }
  return {width:size,height:size,data};
}
