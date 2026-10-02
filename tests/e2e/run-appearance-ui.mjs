/** Appearance interaction checks in Chromium, using the real Settings dialog and shared controls. */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { buildDesignGallery } from "../../scripts/design-gallery.mjs";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
const root = process.cwd(),
  gallery = await buildDesignGallery(),
  out = path.join(root, ".studio-dev/appearance-ui");
await mkdir(out, { recursive: true });
await rm(path.join(out, "report.json"), { force: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "studio-appearance-"));
await writeFile(
  path.join(out, "fixture.tsx"),
  `
import {useState} from 'react';import{createRoot}from'react-dom/client';
import{SettingsDialog}from'${root}/src/renderer/panels/SettingsDialog.tsx';
import{Button}from'${root}/src/renderer/ui/Button.tsx';
import{initializeAppearance,updateAppearance}from'${root}/src/renderer/appearance/store.ts';
import*as themes from'${root}/src/renderer/appearance/themes.ts';
initializeAppearance();Object.assign(window,{appearanceTest:{updateAppearance,...themes}});
function Fixture(){const[open,setOpen]=useState(true),[section,onSection]=useState('appearance');return <><Button id="open-settings" onClick={()=>setOpen(true)}>Settings</Button><Button id="primary" variant="default">Create</Button><Button id="disabled" disabled>Unavailable</Button><div className="prose" id="content-font">A world worth exploring.<code id="code-font">const world = 1;</code></div>{open&&<SettingsDialog section={section as any} onSection={onSection} onDismiss={()=>setOpen(false)} engines={[]} onEnginesRefresh={()=>{}}/>}</>};createRoot(document.getElementById('root')!).render(<Fixture/>);
`,
);
await build({
  entryPoints: [path.join(out, "fixture.tsx")],
  outfile: path.join(out, "fixture.js"),
  bundle: true,
  format: "esm",
  jsx: "automatic",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${path.join(gallery, "gallery.css")}"></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>`,
);
await writeFile(
  path.join(out, "check.cjs"),
  String.raw`
const{app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(path.join(profile, "session"))});
const checks=[];function check(name,ok,detail){checks.push({name,ok,detail});if(!ok)console.error(name,detail);}
app.whenReady().then(async()=>{
const win=new BrowserWindow({width:1200,height:900,show:true,focusable:false,x:-16000,y:-16000,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),wc=win.webContents;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=async code=>{const result=await wc.executeJavaScript('(async()=>{try{return {ok:true,value:await ('+code+')}}catch(e){return {ok:false,error:String(e.stack)}}})()',true);if(!result.ok)throw new Error(result.error+'\nExpression: '+code);return result.value;};
const state=()=>js('JSON.parse(localStorage.getItem("studio.appearance.v1"))');
const capture=async name=>{await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');fs.writeFileSync(${JSON.stringify(out)}+'/'+name+'.png',(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
const click=async selector=>{const p=await js('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');el.scrollIntoView({block:"center"});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});await wait(120);};
const focus=async selector=>{await js('document.querySelector('+JSON.stringify(selector)+').focus()');await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');if(!await js('document.activeElement.matches('+JSON.stringify(selector)+')'))throw new Error('Focus did not settle on '+selector);};
const key=async(name,flags=0)=>{const code=name===' '?'Space':name,p={key:name,code,windowsVirtualKeyCode:({ArrowDown:40,ArrowRight:39,Home:36,End:35,Enter:13,Tab:9,Escape:27,Backspace:8,' ':32})[name]??0,modifiers:flags};await wc.debugger.sendCommand('Input.dispatchKeyEvent',{...p,type:'keyDown',...(name==='Enter'?{text:'\r'}:name===' '?{text:' '}:{})});await wc.debugger.sendCommand('Input.dispatchKeyEvent',{...p,type:'keyUp'});await wait(70);};
const type=async(selector,text)=>{await focus(selector);await js('document.querySelector('+JSON.stringify(selector)+').select()');await wc.debugger.sendCommand('Input.insertText',{text});await wait(50);};
const errors=[];wc.on('console-message',(_e,...args)=>{if(args[0]===3)errors.push(args[1]);});
try{
await win.loadFile(${JSON.stringify(path.join(out, "index.html"))});await js('document.fonts.ready.then(()=>true)');await wait(300);wc.debugger.attach('1.3');
check('appearance is a real modal tab',await js('!!document.querySelector("[role=dialog] [data-appearance]")'));
check('new profiles start with Genex dark',await js('document.documentElement.dataset.theme==="dark"&&document.querySelector("input[value=dark]").checked&&document.querySelector("[aria-label=\\\"dark theme preset\\\"]").textContent.includes("Genex")'));
await click('input[value="system"]');
await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await wait(70);check('system follows dark OS preference',await js('document.documentElement.dataset.theme==="dark"'));
await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await wait(70);check('system follows live light OS preference',await js('document.documentElement.dataset.theme==="light"'));
await focus('input[value="system"]');await key('ArrowRight');check('radio group is keyboard selectable',(await state()).mode==='light');
await focus('[aria-label="light theme preset"]');await key('ArrowDown');await wait(250);check('preset menu opens by keyboard',await js('!!document.querySelector("[role=menu]")'));await capture('light-menu');await key('End');await key('Enter');await wait(200);
check('preset selection saves and restores focus',(await state()).light.preset==='github-light'&&await js('document.activeElement.getAttribute("aria-label")==="light theme preset"'));
await type('[aria-label="light Accent hex"]','banana');await key('Enter');check('invalid color stays out of the applied theme',!(await state()).light.overrides.accent&&await js('document.querySelector("[aria-label=\\\"light Accent hex\\\"]").getAttribute("aria-invalid")==="true"'));
await key('Escape');await wait(200);check('Escape dismisses Settings and discards an invalid draft',await js('!document.querySelector("[role=dialog]")'));await click('#open-settings');await wait(100);

await type('[aria-label="light Accent hex"]','#ffe599');await key('Enter');check('custom accent commits live',(await state()).light.overrides.accent==='#ffe599');
check('bright accent chooses dark label',await js('getComputedStyle(document.querySelector("#primary")).color==="rgb(0, 0, 0)"'));
await click('input[value="dark"]');check('inactive palette is preserved',(await state()).light.overrides.accent==='#ffe599');
await click('[aria-label="dark theme preset"]');await js('[...document.querySelectorAll("[role=menuitemradio]")].find(e=>e.textContent.includes("Tokyo Night")).click()');await wait(200);check('dark preset applies to root',await js('getComputedStyle(document.body).backgroundColor==="rgb(26, 27, 38)"'));
await type('[aria-label="dark Accent hex"]','#aa99ff');await key('Enter');await click('[aria-label="dark theme"] summary');
await js('[...document.querySelectorAll("[aria-label=\\\"dark theme\\\"] button")].find(e=>e.textContent.includes("Save as preset")).click()');await type('[aria-label="dark preset name"]','My dusk');await key('Enter');await wait(100);
check('custom preset stores exact colors',(await state()).saved.some(p=>p.name==='My dusk'&&p.colors.accent==='#aa99ff'));
await wc.reload();await wait(500);check('custom preset and mode survive reload',(await state()).mode==='dark'&&await js('document.querySelector("[aria-label=\\\"dark theme preset\\\"]").textContent.includes("My dusk")'));
await click('[aria-label="Reset dark theme"]');check('per-theme reset retains the other palette',(await state()).dark.preset==='genex-dark'&&(await state()).light.overrides.accent==='#ffe599');
await js('[...document.querySelectorAll("[aria-label=\\\"dark theme\\\"] button")].find(e=>e.textContent==="Import…").click()');await type('#dark-theme-json','{"include":"./another.json"}');await js('[...document.querySelectorAll("[aria-label=\\\"dark theme\\\"] button")].find(e=>e.textContent==="Import theme").click()');await wait(100);check('invalid import explains recovery',await js('document.querySelector("[role=alert]").textContent.includes("resolved colors")'));
await type('#dark-theme-json','{"name":"Imported dusk","type":"dark","colors":{"editor.background":"#171923","button.background":"#73daca"}}');await js('[...document.querySelectorAll("[aria-label=\\\"dark theme\\\"] button")].find(e=>e.textContent==="Import theme").click()');await wait(100);check('VS Code import becomes a saved preset',(await state()).saved.some(p=>p.name==='Imported dusk')&&await js('getComputedStyle(document.body).backgroundColor==="rgb(23, 25, 35)"'));
// Clipboard failure is simulated; the runner never overwrites the person's clipboard.
await js('Object.defineProperty(navigator,"clipboard",{value:{writeText:async()=>{throw new Error("unavailable")}},configurable:true})');await js('[...document.querySelectorAll("[aria-label=\\\"dark theme\\\"] button")].find(e=>e.textContent==="Copy theme").click()');await wait(100);check('clipboard refusal reveals selectable export',await js('document.querySelector("#dark-theme-json").readOnly&&document.querySelector("#dark-theme-json").value.includes("colorSpace")'));
await js('window.appearanceTest.updateAppearance(a=>({...a,uiFont:"system",contentFont:"serif",codeFont:"system"}))');
check('font roles update existing content',await js('getComputedStyle(document.querySelector("#content-font")).fontFamily.includes("Georgia")&&getComputedStyle(document.querySelector("#code-font")).fontFamily.includes("SF Mono")'));
check('pointer cursor includes color controls, labels and icons',await js('["[aria-label=\\\"light theme preset\\\"]","[aria-label=\\\"light theme preset\\\"] svg",".appearance-mode","input[type=color]","summary"].every(s=>getComputedStyle(document.querySelector(s)).cursor==="pointer")'));
check('disabled control avoids pointer',await js('getComputedStyle(document.querySelector("#disabled")).cursor!=="pointer"'));
// Read actual computed (including oklab) values through Canvas, then measure all rendered roles.
const contrasts=await js('(()=>{const t=window.appearanceTest,results=[];const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");const rgb=c=>{ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return "#"+[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(n=>n.toString(16).padStart(2,"0")).join("")};for(const p of t.PRESETS){const el=document.createElement("div");for(const[k,v]of Object.entries(t.themeVariables(p.colors)))el.style.setProperty(k,v);document.body.append(el);const probe=document.createElement("span");el.append(probe);for(const token of ["--foreground","--ink-2","--muted-foreground","--accent-ink"]){probe.style.color="var("+token+")";const fg=rgb(getComputedStyle(probe).color);for(const role of ["background","surface","popover","field","hover"])results.push({preset:p.id,token,role,ratio:t.contrastRatio(fg,p.colors[role])});}el.remove();}return results})()');
check('computed text contrast across ten rendered palettes',contrasts.every(x=>x.ratio>=4.5),{minimumText:Math.min(...contrasts.map(x=>x.ratio))});
await js('window.appearanceTest.updateAppearance(()=>structuredClone(window.appearanceTest.DEFAULT_APPEARANCE))');await click('input[value="dark"]');await capture('genex-dark');await click('input[value="light"]');await capture('genex-light');
for(const width of [900,640,560]){win.setContentSize(width,760);await wait(120);check('settings fit at '+width+' CSS px',await js('(()=>{const el=document.querySelector("[role=dialog]"),panel=document.querySelector("[role=tabpanel]");return el.getBoundingClientRect().left>=0&&el.getBoundingClientRect().right<=innerWidth+1&&panel.scrollWidth<=panel.clientWidth+1})()'));}await capture('compact');
win.setContentSize(1200,900);wc.setZoomFactor(2);await wait(150);check('settings fit at 200% zoom',await js('(()=>{const el=document.querySelector("[role=dialog]"),panel=document.querySelector("[role=tabpanel]");return el.getBoundingClientRect().bottom<=innerHeight+1&&panel.scrollWidth<=panel.clientWidth+1})()'));await capture('zoom-200');
await js('document.documentElement.dir="rtl"');check('RTL layout stays within viewport',await js('document.documentElement.scrollWidth<=innerWidth'));await capture('rtl');await js('document.documentElement.dir="ltr"');
await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});check('theme transitions respect reduced motion',await js('parseFloat(getComputedStyle(document.querySelector("[aria-label=\\\"light theme preset\\\"]")).transitionDuration)<0.001'));
await click('[aria-label="light theme preset"]');await wait(50);await key('Escape');await wait(70);check('Escape closes menu before dialog',await js('!document.querySelector("[role=menu]")&&!!document.querySelector("[role=dialog]")'));
await key('Escape');await wait(80);check('Escape closes Settings',await js('!document.querySelector("[role=dialog]")'));
check('no renderer errors',errors.length===0,errors);
}catch(e){check('runner completed',false,String(e.stack));try{await capture('failure');}catch(error){check('failure capture',false,String(error));}}
fs.writeFileSync(${JSON.stringify(path.join(out, "report.json"))},JSON.stringify({profile:${JSON.stringify(profile)},provider:'none',electron:process.versions.electron,checks},null,2));app.exit(checks.some(c=>!c.ok)?1:0);
});
`,
);
const child = spawn(resolveElectron(), fixtureElectronArgs([path.join(out, "check.cjs")]), {
  env: fixtureElectronEnv(),
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (b) => process.stdout.write(b));
child.stderr.on("data", (b) => process.stderr.write(b));
const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
try {
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  for (const c of report.checks) console.log((c.ok ? "✔ " : "✖ ") + c.name);
  console.log(path.join(out, "report.json"));
  if (code !== 0) process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await rm(profile, { recursive: true, force: true });
}
