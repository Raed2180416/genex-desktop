import { optimizationEvidence } from "../../scripts/test-evidence.mjs";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
/** Render the real Builds component from a saved GPU result, then reload and reopen it. */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const evidence = optimizationEvidence(),
  output = evidence.ui;
let result;
try {
  result = JSON.parse(await readFile(evidence.result, "utf8"));
} catch (error) {
  if (error.code === "ENOENT")
    throw new Error(
      `Missing optimization result: ${evidence.result}. Run npm run test:optimization:e2e first, using the same AG931_OUTPUT if set.`,
    );
  throw error;
}
await mkdir(output, { recursive: true });
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {RunGraph} from './src/renderer/panels/RunGraph.tsx';import {buildRunGraph} from './src/renderer/run-graph.ts';
const r=${JSON.stringify(result)};
const events=[['run_started',{runId:r.runId,project:r.project,goal:'Preserve 64 blocks and HUD',mode:'autopilot'}],['optimization_updated',r],['run_finished',{runId:r.runId,project:r.project,optimization:r,victory:true}]].map(([event_type,payload],i)=>({id:String(i),thread_id:'fixture',session_id:null,turn_id:null,created_at:'2026-09-05T00:00:00Z',data:{type:'custom',event_type,payload}}));
createRoot(document.getElementById('root')).render(<RunGraph graph={buildRunGraph(events)} project={null} onSendNote={async()=>false}/>);`,
    resolveDir: repo,
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  outfile: path.join(output, "ui.js"),
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html><head><link rel="stylesheet" href="${pathToFileURL(path.join(repo, "dist/renderer/theme.css"))}"></head><body><div id="root" style="height:900px;width:1440px;display:flex"></div><script src="ui.js"></script></body></html>`,
);
const entry = path.join(output, "electron.mjs");
await writeFile(
  entry,
  `import {app,BrowserWindow} from 'electron';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
app.setPath('userData',${JSON.stringify(path.join(output, "session"))});
app.whenReady().then(async()=>{const w=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});try{
for(let i=0;i<2;i++){
await w.loadFile(${JSON.stringify(path.join(output, "index.html"))});
for(let n=0;n<100;n++){if(await w.webContents.executeJavaScript('!!document.querySelector(\\'[aria-label="Optimization stage details"]\\')'))break;await new Promise(r=>setTimeout(r,50));}
assert.equal(await w.webContents.executeJavaScript('document.querySelectorAll(\\'[aria-label="Optimization stage details"]\\').length'),1);
await w.webContents.executeJavaScript('document.querySelector(\\'[aria-label="Optimization stage details"]\\').click()');
await new Promise(r=>setTimeout(r,300));
const text=await w.webContents.executeJavaScript('document.body.innerText');assert.match(text,/World draw calls/);assert.match(text,/Candidate kept/);assert.match(text,/64.00/);assert.match(text,/1.00/);
await writeFile(${JSON.stringify(output)}+'/builds-'+i+'.png',(await w.webContents.capturePage()).toPNG());
}
await writeFile(${JSON.stringify(path.join(output, "summary.json"))},JSON.stringify({passed:true,replays:2,cardCount:1,details:'saved WebGL before/after and retained candidate'}));console.log('Optimization Builds UI: saved result reopens after reload');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});`,
);
const executable = resolveElectron(repo);
const child = spawn(executable, fixtureElectronArgs([entry]), {
  cwd: repo,
  stdio: "inherit",
  env: fixtureElectronEnv(),
});
const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
const code = await new Promise((resolve) => child.on("exit", resolve));
clearTimeout(timer);
process.exitCode = code ?? 1;
