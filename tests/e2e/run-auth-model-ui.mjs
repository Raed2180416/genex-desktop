/** Production ChatPanel and model menus across authentication changes in an owned fixture. */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildDesignGallery } from "../../scripts/design-gallery.mjs";
import { resolveElectron, fixtureElectronArgs, fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";
import { sourceIdentity } from "../../scripts/studio-dev/files.mjs";

const out = await buildDesignGallery();
const evidence = path.resolve(".studio-dev/evidence", `auth-model-${Date.now()}`);
await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "genex-auth-model-"));
await build({
  entryPoints: ["tests/fixtures/auth-model.tsx"],
  outfile: path.join(out, "auth-model.js"),
  bundle: true,
  format: "esm",
  jsx: "automatic",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(
  path.join(out, "auth-model.html"),
  '<html data-theme="dark"><head><link rel="stylesheet" href="gallery.css"></head><body><div id="root" style="display:flex;height:800px"></div><script type="module" src="auth-model.js"></script></body></html>',
);
const boot = path.join(out, "auth-model.cjs");
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
  await wc.loadFile(${JSON.stringify(path.join(out, "auth-model.html"))});
  wc.debugger.attach('1.3');
  for(const motion of ['no-preference','reduce']) {
   await wc.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:motion}]});
   const result=await wc.executeJavaScript('window.runAuthChecks()');
   report.checks.push({motion,...result});
   assert.match(result.before, /sol/i);
   assert.match(result.blocked, /sol/i);
   assert.match(result.recovered, /sol/i);
   assert.equal(result.choices.length,4);
   assert.ok(result.choices.every(row=>row.disabled));
   assert.ok(!result.text.includes('Claude Code needs'));
   assert.equal(result.text.split('Codex needs you to sign in again.').length-1,1);
  }
  const catalog = await wc.executeJavaScript('window.runCatalogChecks()');
  report.catalog = catalog;
  assert.match(catalog.loading, /Loading models/);
  assert.equal(catalog.readyLine, null, 'an up-to-date list says nothing: no freshness line, Refresh or Update buttons');
  assert.match(catalog.stale, /Showing saved models\. The list didn't refresh\.Try again/);
  assert.match(catalog.staleDetail, /timed out/);
  assert.ok(!catalog.stale.includes('Not connected'));
  assert.equal(catalog.updateAvailable, true, 'the CLI update lives in the Account menu');
  assert.match(catalog.aliasBefore, /Sonnet 5.5/);
  assert.match(catalog.aliasAfter, /Sonnet Future/);
  assert.equal(catalog.stored, 'claude-code::sonnet');
  assert.ok(catalog.keys.includes('codex::gpt-6.1-sol'));
  assert.ok(!catalog.keys.includes('codex::gpt-6-sol'), 'a newer Sol hides the older one');
  assert.ok(catalog.keys.includes('claude-code::default'));
  const lineup = await wc.executeJavaScript('window.runLineupPicker(true)');
  report.lineup = lineup;
  fs.writeFileSync(${JSON.stringify(path.join(evidence, "picker.png"))},(await wc.capturePage()).toPNG());
  assert.match(lineup.button, /Opus 5\.5/);
  assert.deepEqual(lineup.keys,['claude-code::opus','claude-code::claude-fable-5-1','claude-code::sonnet','codex::gpt-6.1-sol','codex::gpt-6-astra','codex::gpt-6-luna']);
  assert.deepEqual(lineup.checked,['claude-code::opus']);
  assert.ok(lineup.names.every(name=>!/claude-|default/.test(name)),'rows show names only');
  const settings = await wc.executeJavaScript('window.runLineupSettings()');
  report.lineupSettings = settings;
  fs.writeFileSync(${JSON.stringify(path.join(evidence, "settings.png"))},(await wc.capturePage()).toPNG());
  const byId = (rows)=>Object.fromEntries(rows.map(row=>[row.id,row]));
  const before = byId(settings.before.switches), after = byId(settings.after.switches);
  assert.deepEqual([before.opus.on,before.opus.disabled],[true,true],'the default model is always on');
  assert.ok(before['claude-fable-5-1'].on && before.sonnet.on);
  assert.deepEqual([before.haiku.on,before.haiku.visible],[false,false],'Haiku waits, off, under Older models');
  assert.deepEqual([before['gpt-5.6-terra'].on,before['gpt-5.6-terra'].visible],[false,false]);
  assert.equal(settings.before.reset,false);
  assert.deepEqual([after.haiku.on,after.haiku.visible],[true,true]);
  assert.equal(settings.after.reset,true);
  assert.equal(settings.after.stored,'{"claude-code":{"haiku":true}}');
  const turnedOn = await wc.executeJavaScript('window.runLineupPicker(false)');
  report.lineupAfter = turnedOn;
  assert.ok(turnedOn.keys.includes('claude-code::haiku'),'a model switched on in Settings joins the picker');
  for (const [engine,key] of [['codex','codex::gpt-6.1-sol'],['claude-code','claude-code::opus']]) {
   const rows = await wc.executeJavaScript('window.runPermissionPanel('+JSON.stringify(key)+')');
   report['permissions-'+engine] = rows;
   fs.writeFileSync(${JSON.stringify(evidence)}+'/permissions-'+engine+'.png',(await wc.capturePage()).toPNG());
   assert.equal(rows.length,5);
   for (const row of rows) {
    assert.ok(row.oneLine,'one line: '+row.mode+' '+row.text);
    assert.ok(row.iconOnTitle && row.endOnTitle,'icon and end on the title line: '+row.mode);
   }
   assert.deepEqual(rows.map(row=>row.end), engine==='codex' ? ['check','','','4','5'] : ['check','2','3','4','5']);
  }
  assert.deepEqual(report.errors,[]);
  console.log('PASS authentication model identity and provider narration');
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
