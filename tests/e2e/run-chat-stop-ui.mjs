/** Production ChatPanel, held status, and first-frame glyph checks in a disposable Electron profile. */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildDesignGallery } from "../../scripts/design-gallery.mjs";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
import { sourceIdentity } from "../../scripts/studio-dev/files.mjs";

const out = await buildDesignGallery();
const evidence = path.resolve(".studio-dev/evidence", `chat-stop-${Date.now()}`);
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "genex-chat-stop-"));
await build({
  entryPoints: ["tests/fixtures/chat-stop.tsx"],
  outfile: path.join(out, "chat-stop.js"),
  bundle: true,
  format: "esm",
  jsx: "automatic",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  path.join(out, "chat-stop.html"),
  '<html data-theme="dark"><head><link rel="stylesheet" href="gallery.css"></head><body><div id="root" style="display:flex;height:800px"></div><script type="module" src="chat-stop.js"></script></body></html>',
);
const boot = path.join(out, "chat-stop.cjs");
await writeFile(
  boot,
  `
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(profile)});
const report={source:${JSON.stringify(sourceIdentity(process.cwd()))},profile:${JSON.stringify(profile)},providers:'synthetic',checks:[],errors:[]};
report.buildId=report.source.sourceDigest;
report.electron=process.versions.electron;
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1080,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 const wc=win.webContents;
 wc.on('console-message',(event)=>{if(event.level==='error')report.errors.push(event.message)});
 try {
  await wc.loadFile(${JSON.stringify(path.join(out, "chat-stop.html"))});
  wc.debugger.attach('1.3');
  for(const motion of ['no-preference','reduce']) {
   await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motion}]});
   const result=await wc.executeJavaScript('window.runStopChecks()');
   report.checks.push({motion,...result});
   assert.equal(result.before.state,'stop');
   assert.equal(result.pending.state,'stop');
   assert.equal(result.calls,1);
   assert.ok(result.frames.every(frame=>frame.resume),'Resume must render while status is held');
   assert.ok(result.frames.every(frame=>frame.state==='idle'),'settled run must not leave Stop visible');
   const first=result.frames[0];
   assert.equal(first.label,'Send');
   assert.equal(first.stopOpacity,'0');
   assert.equal(first.sendOpacity,'1');
   assert.equal(first.sendTransform,'none');
   assert.equal(first.animations,0);
   assert.equal(result.resumed.state,'stop');
   assert.equal(result.idle.state,'idle');
   assert.equal(result.newRun.state,'stop');
   assert.equal(result.otherThread.state,'stop');
   assert.equal(result.originalThread.state,'idle');
   assert.equal(result.followUp.state,'stop');
  }
  assert.deepEqual(report.errors,[]);
  console.log('PASS ChatPanel held-status and first-frame checks, normal and reduced motion');
 } catch(error) { report.failure=error.stack; console.error(error); }
 fs.writeFileSync(${JSON.stringify(path.join(evidence, "chat.png"))},(await wc.capturePage()).toPNG());
 fs.writeFileSync(${JSON.stringify(path.join(evidence, "report.json"))},JSON.stringify(report,null,2));
 app.exit(report.failure?1:0);
});`,
);
try {
  const child = spawn(resolveElectron(), fixtureElectronArgs([boot]), { env: fixtureElectronEnv(), stdio: "inherit" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
console.log(evidence);
