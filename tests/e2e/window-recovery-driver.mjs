/** A dead studio page comes back by itself, says why in the Studio chat, and stops coming back past its budget. */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = arg("recovery-out"),
  main = arg("recovery-main");
const profile = path.dirname(arg("studio-dev-launch"));
const build = JSON.parse(fs.readFileSync(path.resolve(main, "../../build.json"), "utf8"));
const checks = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let wc;
const js = (code) => wc.executeJavaScript(code, true);
async function until(code) {
  for (let n = 0; n < 300; n++) {
    if (await js(code).catch(() => false)) return true;
    await wait(50);
  }
  return false;
}
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  if (!ok) throw Error(name);
}
const ready = `!!document.querySelector('[aria-label="Prompt"]')`;
const noted = `(async()=>(await window.studio.bootstrap()).events.some(e=>e.data?.type==='error'&&String(e.data.message).includes('stopped unexpectedly (')&&String(e.data.message).includes('was reloaded')))()`;
/** Kills the page and resolves when a new one has loaded, or after 20 s without one. */
function crash() {
  const loaded = new Promise((resolve) => wc.once("did-finish-load", () => resolve(true)));
  wc.forcefullyCrashRenderer();
  return Promise.race([loaded, wait(20_000).then(() => false)]);
}
await import(pathToFileURL(main).href);
async function acceptance() {
  try {
    for (let n = 0; n < 300 && !fs.existsSync(path.join(profile, "controller.json")); n++) await wait(100);
    // The window can open a moment after the controller is written.
    for (let n = 0; n < 300 && !BrowserWindow.getAllWindows().length; n++) await wait(100);
    const win = BrowserWindow.getAllWindows()[0];
    wc = win.webContents;
    win.setFocusable(false);
    win.setPosition(-4000, 0);
    win.showInactive();
    check("owned app is ready", await until(ready));
    check("a dead studio page reloads by itself", (await crash()) && (await until(ready)) && !wc.isCrashed());
    check("the Studio chat says the window stopped and was reloaded", await until(noted));
    check("a second death within the minute reloads too", (await crash()) && (await until(ready)));
    wc.forcefullyCrashRenderer();
    await wait(2_000);
    check("past the budget an unattended session leaves the page dead instead of asking", wc.isCrashed());
  } catch (error) {
    checks.push({ name: "window recovery acceptance completed", ok: false, detail: String(error.stack) });
  } finally {
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(
        {
          buildId: build.buildId,
          sourceDigest: build.sourceDigest,
          outputDigest: build.outputDigest,
          profile: path.basename(profile),
          providers: "fixture",
          electron: process.versions.electron,
          checks,
        },
        null,
        2,
      ),
    );
    app.quit();
  }
}
void acceptance();
