/**
 * Set up runs the srt-win.exe the build ships. Inside a package it sits in app.asar's unpacked
 * twin, because Windows cannot start a file from inside the archive; the translation must touch
 * only the archive segment itself.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { srtWinPath, unpackedPath } from "../../src/substrate/windows-sandbox-setup.ts";

test("a path inside app.asar becomes its app.asar.unpacked twin; any other path is unchanged", () => {
  const win = "\\";
  const cases = [
    [
      "C:\\Users\\ada\\AppData\\Local\\genex\\app-0.1.0\\resources\\app.asar\\node_modules\\x\\srt-win.exe",
      "C:\\Users\\ada\\AppData\\Local\\genex\\app-0.1.0\\resources\\app.asar.unpacked\\node_modules\\x\\srt-win.exe",
    ],
    ["C:\\dev\\genex\\node_modules\\x\\srt-win.exe", "C:\\dev\\genex\\node_modules\\x\\srt-win.exe"],
    // Already unpacked, or a folder that only looks like the archive, stays as it is.
    ["C:\\a\\app.asar.unpacked\\x.exe", "C:\\a\\app.asar.unpacked\\x.exe"],
    ["C:\\a\\my-app.asar\\x.exe", "C:\\a\\my-app.asar\\x.exe"],
    ["C:\\a\\app.asarx\\x.exe", "C:\\a\\app.asarx\\x.exe"],
  ];
  for (const [from, to] of cases) assert.equal(unpackedPath(from, win), to, from);
  assert.equal(
    unpackedPath("/Applications/Genex.app/Contents/Resources/app.asar/x", "/"),
    "/Applications/Genex.app/Contents/Resources/app.asar.unpacked/x",
  );
});

test("outside a package the shipped srt-win.exe is sandbox-runtime's own vendored copy", async () => {
  const exe = await srtWinPath();
  assert.equal(path.basename(exe), "srt-win.exe");
  assert.ok(exe.includes(path.join("@anthropic-ai", "sandbox-runtime", "vendor", "srt-win")), exe);
});
