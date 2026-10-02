/**
 * The developer kit is two scripts an author runs before Studio ever sees their package, so this
 * suite spawns them exactly as `npm run plugin:new` / `npm run plugin:doctor` do — real processes,
 * real exit codes, a temporary working directory — and checks the package they produce with the
 * same `inspectPackage` the installer uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { inspectPackage } from "../../src/substrate/plugins/manifest.ts";
import { isFileSkill } from "../../src/shared/plugins.ts";
import { packageBin } from "../../scripts/package-bin.ts";

const scaffold = path.resolve("scripts/plugin-new.ts");
const doctor = path.resolve("scripts/plugin-doctor.ts");
const pack = path.resolve("scripts/pack-plugin.ts");
const example = path.resolve("src/plugins/example");

const run = (script: string, args: string[], cwd: string) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

function temp(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-devkit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A writable copy of the example, so a test can break one file and doctor the rest. */
function copyExample(dir: string, name: string): string {
  const target = path.join(dir, name);
  fs.cpSync(example, target, { recursive: true });
  return target;
}

test("plugin:new scaffolds an installable package with the example substituted out of it", async (t) => {
  const dir = temp(t);
  const result = run(scaffold, ["my-plugin", "--out", dir], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /plugin:doctor/, "the scaffold must print the next command");

  const target = path.join(dir, "my-plugin");
  const manifest = await inspectPackage(target);
  assert.equal(manifest.id, "my-plugin");
  assert.equal(manifest.name, "My plugin");
  assert.equal(manifest.apiVersion, 2);
  assert.equal(manifest.publisher, "Unpublished");
  assert.match(manifest.description, /My plugin/);

  // A scaffold that kept the example's tool names would teach every model the wrong ones.
  for (const skill of manifest.skills) {
    if (isFileSkill(skill)) continue;
    assert.ok(!skill.text.includes("example__"), `skill ${skill.name} still names example__ tools`);
    assert.match(skill.text, /my-plugin__greet/);
  }
  for (const file of fs.readdirSync(target)) {
    if (!fs.statSync(path.join(target, file)).isFile()) continue;
    assert.ok(
      !fs.readFileSync(path.join(target, file), "utf8").includes("example__"),
      `${file} still names example__ tools`,
    );
  }
  assert.deepEqual(fs.readdirSync(target).sort(), [
    "backend.mjs",
    "jsconfig.json",
    "panel.html",
    "plugin-sdk",
    "plugin.json",
  ]);
  assert.ok(fs.readFileSync(path.join(target, "plugin-sdk/index.d.ts"), "utf8").includes("PluginNativeRuntime"));
  const check = spawnSync(
    process.execPath,
    [packageBin("typescript", "tsc"), "-p", path.join(target, "jsconfig.json")],
    { encoding: "utf8" },
  );
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.equal(manifest.toolbar?.[0]?.ariaLabel, "My plugin demo", "the aria-label must not collide with the example");
});

test("plugin:new refuses a reserved id, a malformed id and an occupied directory", (t) => {
  const dir = temp(t);
  const reserved = run(scaffold, ["example", "--out", dir], dir);
  assert.equal(reserved.status, 1);
  assert.match(reserved.stderr, /reserved/);

  const genex = run(scaffold, ["Genex", "--out", dir], dir);
  assert.equal(genex.status, 1);
  assert.match(genex.stderr, /Invalid plugin id/);
  assert.equal(run(scaffold, ["genex", "--out", dir], dir).status, 1);
  assert.equal(run(scaffold, ["blender", "--out", dir], dir).status, 1);

  assert.equal(run(scaffold, ["taken", "--out", dir], dir).status, 0);
  const again = run(scaffold, ["taken", "--out", dir], dir);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal(run(scaffold, [], dir).status, 1, "no id at all is a usage error");
});

/** Run a panel's inline scripts against a bare stand-in for the sandboxed frame; returns its window. */
function loadPanel(html: string): Record<string, any> {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  assert.ok(scripts.length > 0, "the panel has inline scripts");
  const element = () => ({ textContent: "", style: {}, append() {}, setAttribute() {} });
  const window: Record<string, any> = vm.createContext({
    addEventListener() {},
    parent: { postMessage() {} },
    document: { querySelector: () => ({}), createElement: element, createTextNode: () => ({}) },
    setTimeout,
    clearTimeout,
  });
  window.window = window;
  for (const script of scripts) vm.runInContext(script, window);
  return window;
}

test("plugin:new inlines the current panel SDK into the scaffolded panel (PLG-9)", async (t) => {
  const dir = temp(t);
  assert.equal(run(scaffold, ["panel-check", "--out", dir], dir).status, 0);
  const target = path.join(dir, "panel-check");
  const html = fs.readFileSync(path.join(target, "panel.html"), "utf8");
  assert.ok(!html.includes("STUDIO_PANEL_SDK"), "the marker is replaced");
  const window = loadPanel(html);
  assert.equal(typeof window.studioPlugin?.call, "function");
  assert.equal(
    typeof window.studioPlugin?.onContextChanged,
    "function",
    "the bridge index.d.ts declares is the bridge the panel has",
  );
  assert.equal(typeof window.studioPlugin?.ui?.status, "function", "ui.js comes with it");
  assert.deepEqual(
    fs.readdirSync(path.join(target, "plugin-sdk")),
    ["index.d.ts"],
    "no unused bridge copy beside the panel",
  );
  const doctor = run(path.resolve("scripts/plugin-doctor.ts"), [target, "--json"], dir);
  assert.equal(JSON.parse(doctor.stdout).ok, true, doctor.stdout);
});

test("plugin:pack packs the package only: no dotfiles, dot-folders or editor files, and no links (PLG-9)", async (t) => {
  const dir = temp(t);
  assert.equal(run(scaffold, ["packed", "--out", dir], dir).status, 0);
  const target = path.join(dir, "packed");
  fs.mkdirSync(path.join(target, ".git"));
  fs.writeFileSync(path.join(target, ".git", "config"), '[remote "origin"]');
  fs.writeFileSync(path.join(target, ".env"), "API_KEY=secret");
  fs.mkdirSync(path.join(target, "assets", ".cache"), { recursive: true });
  fs.writeFileSync(path.join(target, "assets", ".cache", "x"), "cache");
  fs.writeFileSync(path.join(target, "assets", "icon.txt"), "icon");
  const artifact = path.join(dir, "packed.json");
  const packed = run(pack, [target, artifact], dir);
  assert.equal(packed.status, 0, packed.stderr);
  const files = Object.keys(JSON.parse(fs.readFileSync(artifact, "utf8"))).sort();
  assert.deepEqual(files, ["assets/icon.txt", "backend.mjs", "panel.html", "plugin.json"]);

  fs.symlinkSync(path.join(dir, "packed.json"), path.join(target, "assets", "linked.json"));
  const linked = run(pack, [target, path.join(dir, "linked.json")], dir);
  assert.notEqual(linked.status, 0, "a link is refused, never followed into the artifact");
  assert.equal(fs.existsSync(path.join(dir, "linked.json")), false);
});

test("plugin:doctor reports the example as installable, safe and ready", (t) => {
  const dir = temp(t);
  const result = run(doctor, [example, "--json"], dir);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.id, "example");
  assert.equal(report.probe, "ready");
  assert.equal(report.scan.verdict, "safe");
  assert.deepEqual(report.scan.findings, []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.toolbar, [
    { id: "demo", label: "Example", ariaLabel: "Example plugin demo", target: "panel:demo", status: "count" },
  ]);

  // The human report is what an author actually reads.
  const human = run(doctor, [example], dir);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /^ok\s/);
  assert.match(human.stdout, /Scan: safe/);
  assert.match(human.stdout, /Probe: ready/);
});

test("plugin:doctor fails a backend that cannot be loaded and echoes its stderr", (t) => {
  const dir = temp(t);
  const target = copyExample(dir, "broken");
  fs.writeFileSync(
    path.join(target, "backend.mjs"),
    "process.stderr.write('activation exploded\\n');\nthrow new Error('boom at import');\n",
  );
  const result = run(doctor, [target, "--json"], dir);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.probe, "failed");
  assert.ok(
    report.errors.some((e: string) => /boom at import/.test(e)),
    report.errors.join("\n"),
  );
  assert.ok(
    report.stderr.some((line: string) => line.includes("activation exploded")),
    "backend stderr must reach the report",
  );
});

test("plugin:doctor refuses an unreadable package and reports panel CSP problems as warnings", (t) => {
  const dir = temp(t);
  const invalid = copyExample(dir, "invalid");
  fs.writeFileSync(path.join(invalid, "plugin.json"), JSON.stringify({ apiVersion: 2, id: "invalid" }));
  const broken = run(doctor, [invalid, "--json"], dir);
  assert.equal(broken.status, 1);
  assert.match(JSON.parse(broken.stdout).errors.join("\n"), /not installable/);
  assert.equal(run(doctor, [path.join(dir, "absent")], dir).status, 1);

  const csp = copyExample(dir, "csp");
  const panel = path.join(csp, "panel.html");
  fs.writeFileSync(panel, `<script src="https://cdn.example.test/chart.js"></script>${fs.readFileSync(panel, "utf8")}`);
  const result = run(doctor, [csp, "--json"], dir);
  const report = JSON.parse(result.stdout);
  assert.ok(
    report.warnings.some((w: string) => /external script/.test(w)),
    report.warnings.join("\n"),
  );
  assert.ok(
    report.warnings.some((w: string) => /cdn\.example\.test/.test(w)),
    report.warnings.join("\n"),
  );
  // The scan sees the undeclared host too, and that is a disclosure, not an installation block.
  assert.equal(report.scan.verdict, "caution");
  assert.equal(report.probe, "ready");
  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true);
  assert.equal(result.status, 0);
});
