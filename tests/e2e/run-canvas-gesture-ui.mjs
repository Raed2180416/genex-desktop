import { fileURLToPath } from "node:url";
/** Real native animation-frame bindings and StrictMode cleanup, in a disposable Electron profile. */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixtureElectronArgs, fixtureElectronEnv, resolveElectron } from "../../scripts/electron-runtime.mjs";
import { sourceIdentity } from "../../scripts/studio-dev/files.mjs";
const out = path.resolve(".studio-dev/evidence/canvas-native-binding");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "studio-canvas-binding-"));
await build({
  entryPoints: [fileURLToPath(new URL("./canvas-gesture-fixture.tsx", import.meta.url))],
  outfile: path.join(out, "fixture.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});
await writeFile(path.join(out, "index.html"), '<!doctype html><div id="root"></div><script src="fixture.js"></script>');
const bootstrap = path.join(out, "check.cjs");
await writeFile(
  bootstrap,
  `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const {setTimeout:wait}=require('node:timers/promises');
app.setPath('userData',${JSON.stringify(profile)});
app.setPath('sessionData',${JSON.stringify(path.join(profile, "session"))});
app.whenReady().then(async()=>{
 const report={source:${JSON.stringify(sourceIdentity(process.cwd()))},profile:${JSON.stringify(profile)},provider:'none',electron:process.versions.electron};
 const win=new BrowserWindow({width:600,height:420,x:-12000,y:-12000,show:false,focusable:false,webPreferences:{sandbox:true,contextIsolation:true}});
 try{
  win.showInactive();
  report.backgroundThrottling=win.webContents.getBackgroundThrottling();
  await win.loadFile(${JSON.stringify(path.join(out, "index.html"))});
  let state={};
  for(let i=0;i<40;i++){
   await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
   await wait(50);
   state=await win.webContents.executeJavaScript('({result:document.body.dataset.result,error:document.body.dataset.error})');
   if(state.result||state.error)break;
  }
  report.state=state;
  const r=state.result?JSON.parse(state.result):null;
  report.ok=!state.error&&r?.during.paints===0&&r?.during.commits===0&&r?.painted.paints===1&&r?.painted.commits===0&&r?.finished.paints===1&&r?.finished.commits===1&&r?.tx===100&&report.backgroundThrottling===true;
 }catch(error){report.error=String(error.stack||error);report.ok=false;}
 fs.writeFileSync(${JSON.stringify(path.join(out, "report.json"))},JSON.stringify(report,null,2));
 app.exit(report.ok?0:1);
});
`,
);
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(resolveElectron(), fixtureElectronArgs([bootstrap]), {
      env: fixtureElectronEnv(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = code === 0 && report.ok ? 0 : 1;
} finally {
  await rm(profile, { recursive: true, force: true });
}
