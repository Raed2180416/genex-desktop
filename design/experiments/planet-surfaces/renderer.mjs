import {validateRecipe,PALETTES} from './recipes.mjs';
import {createSphereRenderer} from '../spheres/renderer.mjs';

/** One solid sphere. All procedural variation is attached to its spherical surface. */
export function renderPlanet(input,size=320){
  const recipe=validateRecipe(input);
  if(!Number.isInteger(size)||size<28||size>768)throw Error('Size must be an integer between 28 and 768.');
  if(recipe.surface==='cloud-pearl')return createSphereRenderer(recipe.seed)({size,variant:'pearl',hue:226,color:recipe.palette==='ice'?undefined:PALETTES[recipe.palette],gloss:.7});
  let state=recipe.seed;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const clamp=v=>Math.max(0,Math.min(1,v)),mix=(a,b,t)=>a+(b-a)*t;
  const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
  const normalize=(x,y,z)=>{const l=Math.hypot(x,y,z);return [x/l,y/l,z/l];};
  const base=PALETTES[recipe.palette],pale=base.map(c=>mix(c,1,.85));
  const table=Float32Array.from({length:8192},random),offset=random()*130;
  function hash(x,y,z){return table[((Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))>>>0)&8191];}
  function noise(x,y,z){
    const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z);
    let u=x-X,v=y-Y,w=z-Z;
    u=u*u*u*(u*(u*6-15)+10);v=v*v*v*(v*(v*6-15)+10);w=w*w*w*(w*(w*6-15)+10);
    return mix(mix(mix(hash(X,Y,Z),hash(X+1,Y,Z),u),mix(hash(X,Y+1,Z),hash(X+1,Y+1,Z),u),v),mix(mix(hash(X,Y,Z+1),hash(X+1,Y,Z+1),u),mix(hash(X,Y+1,Z+1),hash(X+1,Y+1,Z+1),u),v),w);
  }
  function fbm(x,y,z){return noise(x,y,z)*.55+noise(x*2.03+11,y*2.03,z*2.03)*.27+noise(x*4.13,y*4.13+8,z*4.13)*.12+noise(x*8.29,y*8.29,z*8.29+13)*.06;}
  function cells(x,y,z){
    const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z);let first=100,second=100,id=0;
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++){
      const px=X+i+.15+.70*hash(X+i,Y+j,Z+k),py=Y+j+.15+.70*hash(X+i+41,Y+j+73,Z+k),pz=Z+k+.15+.70*hash(X+i+13,Y+j,Z+k+21);
      const d=(x-px)**2+(y-py)**2+(z-pz)**2;
      if(d<first){second=first;first=d;id=hash(X+i+81,Y+j,Z+k+31);}else if(d<second)second=d;
    }
    return {edge:Math.sqrt(second)-Math.sqrt(first),id};
  }
  const craters=Array.from({length:40},(_,i)=>{
    const y=random()*2-1,angle=random()*Math.PI*2,r=Math.sqrt(1-y*y);
    return {x:Math.cos(angle)*r,y,z:Math.sin(angle)*r,radius:i<9?.20+random()*.13:.055+random()*.13};
  });
  const tilt=(random()-.5)*1.05,ct=Math.cos(tilt),st=Math.sin(tilt);
  const storm={x:.25+(random()-.5)*.3,y:-.20+(random()-.5)*.35};
  function craterHeight(x,y,z){
    let h=0;
    for(const crater of craters){
      const d=Math.sqrt((x-crater.x)**2+(y-crater.y)**2+(z-crater.z)**2)/crater.radius;
      if(d>1.36)continue;
      const bowl=d<1?-.105*crater.radius*(1-d*d)**2:0;
      const rim=.060*crater.radius*Math.exp(-(((d-.96)/.13)**2));
      h+=bowl+rim;
    }
    return h;
  }
  function sample(x,y,z,heightOnly=false){
    let color,roughness=.55,height=0;
    const surface=recipe.surface;
    if(surface==='ocean'){
      const terrain=fbm(x*2.2+offset,y*2.2,z*2.2);
      const land=smooth(.48,.505,terrain),beach=smooth(.475,.51,terrain)*(1-smooth(.51,.54,terrain));
      const vegetation={ice:[.22,.36,.17],violet:[.40,.31,.39],jade:[.28,.42,.18],amber:[.52,.37,.19],rose:[.40,.29,.32],silver:[.29,.34,.30]}[recipe.palette];
      const dry=smooth(.60,.76,terrain),sand=[.66,.60,.40];
      color=base.map((c,k)=>mix(c*(.30+.48*smooth(.30,.48,terrain)),mix(vegetation[k],sand[k],dry),land));
      color=color.map((c,k)=>mix(c,sand[k],beach*.25));
      height=land*(terrain-.48)*.055;roughness=mix(.13,.8,land);
    }else if(surface==='craters'){
      const dust=fbm(x*6+offset,y*6,z*6);
      color=base.map(c=>mix(c,.57,.73)*(.70+.47*dust));
      height=craterHeight(x,y,z)+(dust-.5)*.005;roughness=.93;
    }else if(surface==='bands'){
      let bx=x,by=y;
      if(recipe.layer==='storms'){
        const dx=x-storm.x,dy=(y-storm.y)*1.9,r=Math.hypot(dx,dy);
        const twist=3.2*Math.exp(-r*r/.13);
        bx=storm.x+Math.cos(twist)*dx-Math.sin(twist)*dy;
        by=storm.y+(Math.sin(twist)*dx+Math.cos(twist)*dy)/1.9;
      }
      const turbulence=fbm(bx*4+offset,by*4,z*4);
      const latitude=by*ct+bx*st;
      const a=Math.sin(latitude*29+turbulence*5),b=Math.sin(latitude*67+turbulence*9);
      const stripe=smooth(-.4,.75,a*.75+b*.18);
      color=base.map((c,k)=>mix(c*.66,pale[k],stripe*.86));
      color=color.map(c=>c*(.83+turbulence*.25));height=(turbulence-.5)*.001;roughness=.53;
    }else if(surface==='marble'){
      const warp=noise(x*1.3+offset,y*1.3,z*1.3);
      const swirl=noise(x*1.25+warp*.9+offset,y*1.25-warp*1.1,z*1.25+warp);
      const flow=Math.sin((x*.5+y*.65+swirl*2)*10);
      const band=smooth(-.55,.40,flow);
      color=base.map((c,k)=>mix(c*.42,pale[k],band*.87));
      const fineLine=Math.exp(-((flow/.095)**2));color=color.map(c=>c*(1-fineLine*.28));
      height=(swirl-.5)*.003;roughness=.16;
    }
    if(heightOnly)return height;
    if(recipe.layer==='clouds'){
      const cloud=smooth(.49,.70,fbm(x*4.6+offset+22,y*4.6,z*4.6));
      const shadow=smooth(.49,.69,fbm(x*4.6+offset+22.10,y*4.6-.10,z*4.6));
      color=color.map((c,k)=>mix(c*(1-shadow*.23),pale[k],cloud*.95));roughness=mix(roughness,.8,cloud);
    }
    if(recipe.layer==='frost'){
      const ice=smooth(.30,.70,Math.abs(y)*.55+fbm(x*3+offset+7,y*3,z*3)*.45);
      color=color.map((c,k)=>mix(c,pale[k],ice*.86));roughness=mix(roughness,.40,ice);
    }
    if(recipe.layer==='veins'){
      const vein=1-smooth(.008,.040,cells(x*3.4+offset,y*3.4,z*3.4).edge);
      color=color.map((c,k)=>mix(c,[.81,.60,.29][k],vein*.82));
    }
    return {color,roughness,height};
  }
  const light=normalize(-.48,.62,.76),half=normalize(light[0],light[1],light[2]+1);
  const data=new Uint8ClampedArray(size*size*4),radius=.88,eps=.004;
  for(let py=0;py<size;py++)for(let px=0;px<size;px++){
    const x=(2*(px+.5)/size-1)/radius,y=(1-2*(py+.5)/size)/radius,r2=x*x+y*y;
    if(r2>=1)continue;
    const z=Math.sqrt(1-r2),surface=sample(x,y,z);
    let nx=x,ny=y,nz=z;
    if(['craters','ocean'].includes(recipe.surface)){
      const gx=(sample(x+eps,y,z,true)-surface.height)/eps,gy=(sample(x,y+eps,z,true)-surface.height)/eps,gz=(sample(x,y,z+eps,true)-surface.height)/eps;
      const radial=gx*x+gy*y+gz*z;
      [nx,ny,nz]=normalize(x-(gx-radial*x),y-(gy-radial*y),z-(gz-radial*z));
    }
    const diffuse=Math.max(0,nx*light[0]+ny*light[1]+nz*light[2]);
    const glossy=1-surface.roughness;
    const spec=Math.pow(Math.max(0,nx*half[0]+ny*half[1]+nz*half[2]),30+glossy*150)*(glossy*.75+.025);
    const fresnel=Math.pow(1-z,4);
    const rx=2*x*z,ry=2*y*z,rz=2*z*z-1;
    const reflection=Math.exp(-(((rx+.50)/.26)**2+((ry-.60)/.15)**2))*smooth(.1,.5,rz)*glossy*.37;
    let color=surface.color.map(c=>c*(.22+.78*diffuse));
    if(recipe.layer==='metallic'){
      const studio=.20+.65*smooth(-.25,.35,ry)+Math.exp(-(((ry+.40)/.09)**2))*.30;
      color=color.map((c,k)=>mix(c,base[k]*studio+pale[k]*Math.exp(-(((ry-.30)/.16)**2))*.50,.46));
    }
    const edge=smooth(0,2.8/size,1-Math.sqrt(r2)),i=(py*size+px)*4;
    for(let k=0;k<3;k++)data[i+k]=Math.round(clamp(color[k]+spec+reflection+pale[k]*fresnel*(recipe.surface==='ocean'?.15:.075))*255);
    data[i+3]=Math.round(edge*255);
  }
  return {width:size,height:size,data};
}
