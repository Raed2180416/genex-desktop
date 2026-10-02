/**
 * `look-at-page`: a hostile-input table where every refused URL or screenshot path starts no
 * browser and writes no file, a loopback look through a fake browser, and the PATH shim. No
 * Chromium is launched.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  isLoopbackHost,
  LOOK_EXIT,
  type LookBrowser,
  LookRefusal,
  lookAtPage,
  parseLookArgs,
} from "../../scripts/evals/lanes/look-at-page.ts";
import { installLookAtPageTool, writeLookAtPageShim } from "../../scripts/evals/lanes/look-at-page-tool.ts";

const repo = path.resolve(import.meta.dirname, "../..");

const temps: string[] = [];
const tempDir = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eval-look-")));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A browser that records calls and writes the screenshot it was asked for. */
function recordingBrowser(): { browser: LookBrowser; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    browser: async (url, out) => {
      calls.push(url.href);
      fs.writeFileSync(out, "png");
      return { status: 200, consoleErrors: ["Uncaught TypeError: x is undefined"], screenshot: out };
    },
  };
}

describe("look-at-page refusals", () => {
  const hostile: Array<[string, string[], LookRefusal]> = [
    ["no URL", [], LookRefusal.Usage],
    ["an unknown flag", ["http://localhost:5173", "--full"], LookRefusal.Usage],
    ["--out without a path", ["http://localhost:5173", "--out"], LookRefusal.Usage],
    ["extra arguments", ["http://localhost:5173", "--out", "a.png", "b"], LookRefusal.Usage],
    ["not a URL", ["localhost:5173"], LookRefusal.NotHttp],
    ["garbage", ["::::"], LookRefusal.NotUrl],
    ["a file URL", ["file:///etc/passwd"], LookRefusal.NotHttp],
    ["a data URL", ["data:text/html,<h1>x</h1>"], LookRefusal.NotHttp],
    ["javascript:", ["javascript:alert(1)"], LookRefusal.NotHttp],
    ["a public host", ["https://example.com"], LookRefusal.NotLoopback],
    ["a host that starts with localhost", ["http://localhost.example.com:5173"], LookRefusal.NotLoopback],
    ["credentials that hide a host", ["http://127.0.0.1@example.com/"], LookRefusal.NotLoopback],
    ["credentials on loopback", ["http://user:pw@localhost:5173/"], LookRefusal.NotLoopback],
    ["a private LAN address", ["http://192.168.1.10:5173"], LookRefusal.NotLoopback],
    ["the unspecified address", ["http://0.0.0.0:5173"], LookRefusal.NotLoopback],
    ["a screenshot that is not a PNG", ["http://localhost:5173", "--out", "shot.jpg"], LookRefusal.OutNotPng],
    ["a screenshot above the folder", ["http://localhost:5173", "--out", "../shot.png"], LookRefusal.OutOutsideCwd],
    [
      "an absolute screenshot elsewhere",
      ["http://localhost:5173", "--out", "/tmp/shot.png"],
      LookRefusal.OutOutsideCwd,
    ],
  ];
  for (const [name, args, refusal] of hostile)
    it(`refuses ${name}, starts no browser and writes nothing`, async () => {
      const cwd = tempDir();
      assert.deepEqual(parseLookArgs(args, cwd), { ok: false, refusal });
      const { browser, calls } = recordingBrowser();
      const lines: string[] = [];
      assert.equal(await lookAtPage(args, { cwd, out: (line) => lines.push(line), browser }), LOOK_EXIT.Refused);
      assert.deepEqual(calls, []);
      assert.deepEqual(fs.readdirSync(cwd), []);
      assert.ok(lines[0]?.includes(refusal));
    });

  it("refuses a screenshot folder that is a link out of the current folder", async () => {
    const cwd = tempDir();
    const elsewhere = tempDir();
    fs.symlinkSync(elsewhere, path.join(cwd, "shots"));
    const { browser, calls } = recordingBrowser();
    const code = await lookAtPage(["http://127.0.0.1:8080/", "--out", "shots/a.png"], { cwd, out: () => {}, browser });
    assert.equal(code, LOOK_EXIT.Refused);
    assert.deepEqual(calls, []);
    assert.deepEqual(fs.readdirSync(elsewhere), []);
  });

  it("knows the loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "127.8.9.10", "[::1]"]) assert.ok(isLoopbackHost(host), host);
    for (const host of ["localhost.", "127.0.0.256", "128.0.0.1", "example.com", "::1"])
      assert.equal(isLoopbackHost(host), false, host);
  });
});

describe("look-at-page on loopback", () => {
  it("opens the page, prints its console errors and saves the screenshot in the current folder", async () => {
    const cwd = tempDir();
    const { browser, calls } = recordingBrowser();
    const lines: string[] = [];
    const code = await lookAtPage(["http://localhost:5173/?level=1", "--out", "shot.png"], {
      cwd,
      out: (line) => lines.push(line),
      browser,
    });
    assert.equal(code, LOOK_EXIT.Ok);
    assert.deepEqual(calls, ["http://localhost:5173/?level=1"]);
    assert.ok(fs.existsSync(path.join(cwd, "shot.png")));
    assert.deepEqual(lines, [
      "status: 200",
      "console errors: 1",
      "  Uncaught TypeError: x is undefined",
      `screenshot: ${path.join(cwd, "shot.png")}`,
    ]);
  });

  it("reports a browser failure with its own exit code", async () => {
    const cwd = tempDir();
    const failing: LookBrowser = async () => Promise.reject(new Error("net::ERR_CONNECTION_REFUSED"));
    const lines: string[] = [];
    const code = await lookAtPage(["http://localhost:1"], { cwd, out: (line) => lines.push(line), browser: failing });
    assert.equal(code, LOOK_EXIT.Failed);
    assert.ok(lines[0]?.includes("ERR_CONNECTION_REFUSED"));
  });

  it("installs the command outside the checkout, so the shim a lane can read never names the repository", async () => {
    const builds = path.join(tempDir(), "builds");
    const script = await installLookAtPageTool(builds);
    assert.ok(script.startsWith(builds + path.sep));
    const dir = path.join(tempDir(), "bin");
    await writeLookAtPageShim(dir, process.execPath, script);
    const text = fs.readFileSync(path.join(dir, "look-at-page"), "utf8");
    assert.equal(text.includes(repo), false, text);
    assert.ok(
      createRequire(script)
        .resolve("@playwright/test")
        .startsWith(builds + path.sep),
    );
    const refused = spawnSync(process.execPath, [script, "file:///etc/passwd"], { cwd: tempDir(), encoding: "utf8" });
    assert.equal(refused.status, LOOK_EXIT.Refused, refused.stderr);
    assert.match(refused.stdout, /refused \(not-http\)/);
    assert.equal(await installLookAtPageTool(builds), script, "a finished install is reused");
  });

  it("writes an executable shim that runs this command with a quoted Node and script", async () => {
    const dir = path.join(tempDir(), "bin");
    await writeLookAtPageShim(dir, "/opt/node's/bin/node", "/repo/look-at-page.ts");
    const shim = path.join(dir, "look-at-page");
    assert.equal(
      fs.readFileSync(shim, "utf8"),
      `#!/bin/sh\nexec '/opt/node'\\''s/bin/node' '/repo/look-at-page.ts' "$@"\n`,
    );
    assert.ok(fs.statSync(shim).mode & 0o111);
  });
});
