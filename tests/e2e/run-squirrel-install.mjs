/**
 * Install the Windows Squirrel installer the way a person does, then uninstall it (Windows only).
 *
 * Setup.exe unpacks the app into %LOCALAPPDATA%\genex\app-<version>, starts it once with
 * `--squirrel-install` (main makes the Start menu and desktop shortcuts through Update.exe and
 * exits) and then opens it. The checks: the install lands, the shortcuts appear, no installed
 * path reaches MAX_PATH, and `Update.exe --uninstall` takes the shortcuts away again. The copy
 * Setup.exe opens is closed before the uninstall; it runs on the CI machine's own profile.
 *
 *   npm run make -- --platform win32 --arch x64 && node tests/e2e/run-squirrel-install.mjs
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
/** forge.config.cjs's maker-squirrel `name` and `setupExe`. */
const INSTALL_NAME = "genex";
const SETUP_EXE = path.join(root, "out", "make", "squirrel.windows", "x64", "Genex-Setup.exe");
/** Windows' MAX_PATH, which counts the terminating NUL. */
const MAX_PATH = 260;
const SETUP_TIMEOUT_MS = 5 * 60_000;
const SETTLE_TIMEOUT_MS = 2 * 60_000;
const POLL_MS = 1_000;

const installDir = path.join(process.env.LOCALAPPDATA ?? "", INSTALL_NAME);
const shortcutRoots = [
  path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs"),
  path.join(process.env.USERPROFILE ?? "", "Desktop"),
];
const results = [];

function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `  — ${detail}` : ""}`);
}

async function filesUnder(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

async function genexShortcuts() {
  const found = await Promise.all(shortcutRoots.map(filesUnder));
  return found.flat().filter((file) => /^genex.*\.lnk$/i.test(path.basename(file)));
}

/** Poll `probe` until it returns a truthy value or the settle time runs out. */
async function settle(probe) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const value = await probe();
    if (value || Date.now() > deadline) return value;
    await delay(POLL_MS);
  }
}

async function installedApp() {
  const versions = (await readdir(installDir).catch(() => [])).filter((name) => name.startsWith("app-"));
  const exe = versions.map((name) => path.join(installDir, name, `${INSTALL_NAME}.exe`)).find(existsSync);
  return exe ?? null;
}

/** Close the copy Setup.exe opened: only processes running from the install folder. */
async function closeInstalledCopies() {
  const script = `Get-Process ${INSTALL_NAME} -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${installDir}\\*' } | Stop-Process -Force`;
  await run("powershell.exe", ["-NoProfile", "-Command", script]).catch(() => {});
}

function printSetupLogs() {
  for (const log of [
    path.join(process.env.LOCALAPPDATA ?? "", "SquirrelTemp", "SquirrelSetup.log"),
    path.join(installDir, "SquirrelSetup.log"),
  ]) {
    if (existsSync(log)) console.log(`--- ${log}\n${readFileSync(log, "utf8").slice(-4000)}`);
  }
}

if (process.platform !== "win32") {
  console.log("the Squirrel install check runs on Windows only");
  process.exit(0);
}

console.log(`installing ${SETUP_EXE}\n  into ${installDir}`);
await run(SETUP_EXE, ["--silent"], { timeout: SETUP_TIMEOUT_MS }).catch((error) => {
  console.log(`Setup.exe: ${error.message}`);
});
const exe = await settle(installedApp);
check("Setup.exe installs the app under %LOCALAPPDATA%\\genex", Boolean(exe), exe ?? "no app-<version>\\genex.exe");
const shortcuts = await settle(async () => {
  const found = await genexShortcuts();
  return found.length ? found : null;
});
check(
  "the install launch makes the Start menu and desktop shortcuts",
  Boolean(shortcuts),
  (shortcuts ?? []).join(", "),
);
const tooLong = (await filesUnder(installDir)).filter((file) => file.length >= MAX_PATH);
check(`every installed path is under ${MAX_PATH} characters`, tooLong.length === 0, tooLong.slice(0, 3).join(", "));

await closeInstalledCopies();
await run(path.join(installDir, "Update.exe"), ["--uninstall", "-s"], { timeout: SETUP_TIMEOUT_MS }).catch((error) => {
  console.log(`Update.exe --uninstall: ${error.message}`);
});
const removed = await settle(async () => (await genexShortcuts()).length === 0);
check("Update.exe --uninstall removes the shortcuts", removed);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Squirrel install checks passed`);
if (passed !== results.length) {
  printSetupLogs();
  process.exit(1);
}
