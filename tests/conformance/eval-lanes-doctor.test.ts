/**
 * `eval doctor`: every check of §12 with injected answers, the terminal report and the exit code.
 * Read-only by construction: the fakes record what was asked and the temporary evals home is never
 * created. No CLI, browser or account is touched.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  DOCTOR_EXIT_FAILED,
  DoctorCheck,
  type DoctorDeps,
  doctorCommand,
  doctorExitCode,
  MIN_FREE_DISK_BYTES,
  runDoctor,
} from "../../scripts/evals/doctor.ts";
import { evalsLayout } from "../../scripts/evals/lanes/homes.ts";
import { CheckResult } from "../../scripts/evals/vocabulary.ts";
import { EngineId } from "../../src/shared/providers.ts";

const temps: string[] = [];
const tempDir = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eval-doctor-")));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function deps(root: string, change: Partial<DoctorDeps> = {}): DoctorDeps {
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const skills = path.join(root, "skills");
  fs.mkdirSync(path.join(skills, "genex-helper"), { recursive: true });
  fs.writeFileSync(path.join(skills, "genex-helper", "SKILL.md"), "s");
  const chromium = path.join(root, "chromium");
  fs.writeFileSync(chromium, "");
  const layout = evalsLayout(path.join(home, ".genex-evals"));
  return {
    nodeVersion: "v24.18.0",
    layout,
    home,
    resolveCli: async (engine) => ({ path: `/bin/${engine}-cli`, version: "1.0.0" }),
    homesStatus: async (at) => [
      { engine: EngineId.ClaudeCode, home: at.homes.claude, loggedIn: true, apiKeyLogin: false },
      { engine: EngineId.Codex, home: at.homes.codex, loggedIn: true, apiKeyLogin: false },
    ],
    hostSkillsDir: skills,
    chromiumPath: async () => chromium,
    freeBytes: async () => MIN_FREE_DISK_BYTES * 2,
    readQuota: async () => ({
      measuredAt: "2026-10-01T12:00:00.000Z",
      windows: [{ id: "five_hour", label: "5h", percent: 12 }],
    }),
    maxQuotaPercent: 70,
    env: {},
    ...change,
  };
}

describe("eval doctor", () => {
  it("passes every check on a ready machine, lists the host skills and creates nothing", async () => {
    const root = tempDir();
    const given = deps(root);
    const results = await runDoctor(given);
    assert.deepEqual(
      results.map((r) => [r.check, r.engine, r.result]),
      [
        [DoctorCheck.Node, null, CheckResult.Pass],
        [DoctorCheck.Cli, EngineId.ClaudeCode, CheckResult.Pass],
        [DoctorCheck.Cli, EngineId.Codex, CheckResult.Pass],
        [DoctorCheck.HomeAuth, EngineId.ClaudeCode, CheckResult.Pass],
        [DoctorCheck.HomeAuth, EngineId.Codex, CheckResult.Pass],
        [DoctorCheck.HostSkills, null, CheckResult.Pass],
        [DoctorCheck.Chromium, null, CheckResult.Pass],
        [DoctorCheck.Disk, null, CheckResult.Pass],
        [DoctorCheck.EvalsHome, null, CheckResult.Pass],
        [DoctorCheck.HomeEnv, null, CheckResult.Pass],
        [DoctorCheck.Quota, EngineId.ClaudeCode, CheckResult.Pass],
        [DoctorCheck.Quota, EngineId.Codex, CheckResult.Pass],
      ],
    );
    assert.deepEqual(results.find((r) => r.check === DoctorCheck.HostSkills)?.items, [
      path.join(root, "skills", "genex-helper", "SKILL.md"),
    ]);
    assert.equal(doctorExitCode(results), 0);
    assert.equal(fs.existsSync(given.layout.root), false);
  });

  const failing: Array<[string, (root: string) => Partial<DoctorDeps>, DoctorCheck, CheckResult]> = [
    ["another Node", () => ({ nodeVersion: "v22.1.0" }), DoctorCheck.Node, CheckResult.Fail],
    [
      "a missing CLI",
      () => ({ resolveCli: async () => Promise.reject(new Error("Install this coding CLI")) }),
      DoctorCheck.Cli,
      CheckResult.Fail,
    ],
    [
      "a signed-out home",
      () => ({
        homesStatus: async (at) => [
          { engine: EngineId.ClaudeCode, home: at.homes.claude, loggedIn: false, apiKeyLogin: false },
        ],
      }),
      DoctorCheck.HomeAuth,
      CheckResult.Fail,
    ],
    [
      "a Codex API-key login",
      () => ({
        homesStatus: async (at) => [
          { engine: EngineId.Codex, home: at.homes.codex, loggedIn: true, apiKeyLogin: true },
        ],
      }),
      DoctorCheck.HomeAuth,
      CheckResult.Fail,
    ],
    [
      "a CLI that could not be asked",
      () => ({
        homesStatus: async (at) => [
          { engine: EngineId.Codex, home: at.homes.codex, loggedIn: null, apiKeyLogin: false },
        ],
      }),
      DoctorCheck.HomeAuth,
      CheckResult.Unknown,
    ],
    ["no Chromium", () => ({ chromiumPath: async () => null }), DoctorCheck.Chromium, CheckResult.Fail],
    [
      "a Chromium path that is gone",
      (root) => ({ chromiumPath: async () => path.join(root, "gone") }),
      DoctorCheck.Chromium,
      CheckResult.Fail,
    ],
    ["too little disk", () => ({ freeBytes: async () => 1024 }), DoctorCheck.Disk, CheckResult.Fail],
    ["unknown disk", () => ({ freeBytes: async () => null }), DoctorCheck.Disk, CheckResult.Unknown],
    [
      "an evals home inside a repository",
      (root) => {
        fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
        return { layout: evalsLayout(path.join(root, "repo", "evals")) };
      },
      DoctorCheck.EvalsHome,
      CheckResult.Fail,
    ],
    [
      "a window above the ceiling",
      () => ({
        readQuota: async () => ({ measuredAt: "x", windows: [{ id: "seven_day", label: "7d", percent: 91 }] }),
      }),
      DoctorCheck.Quota,
      CheckResult.Fail,
    ],
    ["unreadable quota", () => ({ readQuota: async () => null }), DoctorCheck.Quota, CheckResult.Unknown],
  ];
  for (const [name, change, check, expected] of failing)
    it(`reports ${name} as ${expected}`, async () => {
      const root = tempDir();
      const results = await runDoctor(deps(root, change(root)));
      const row = results.find((r) => r.check === check && r.result !== CheckResult.Pass);
      assert.equal(row?.result, expected);
      assert.equal(doctorExitCode(results), expected === CheckResult.Fail ? 1 : 0);
    });

  it("prints one line per check and returns the exit code as a command", async () => {
    const root = tempDir();
    const lines: string[] = [];
    const code = await doctorCommand([], (line) => lines.push(line), deps(root, { nodeVersion: "v20.0.0" }));
    assert.equal(code, 1);
    const text = lines.join("\n");
    assert.match(text, /^fail {4}node: node v20\.0\.0$/m);
    assert.match(text, /^pass {4}host-skills: 1 host skills disabled per path$/m);
  });

  it("starts no quota session for a home that is not signed in, so a fresh machine stays untouched", async () => {
    const root = tempDir();
    const asked: string[] = [];
    const given = deps(root, {
      homesStatus: async (at) => [
        { engine: EngineId.ClaudeCode, home: at.homes.claude, loggedIn: false, apiKeyLogin: false },
        { engine: EngineId.Codex, home: at.homes.codex, loggedIn: null, apiKeyLogin: false },
      ],
      readQuota: async (engine) => {
        asked.push(engine);
        return { measuredAt: "x", windows: [] };
      },
    });
    const results = await runDoctor(given);
    assert.deepEqual(asked, []);
    const quota = results.filter((r) => r.check === DoctorCheck.Quota);
    assert.deepEqual(
      quota.map((r) => [r.engine, r.result]),
      [
        [EngineId.ClaudeCode, CheckResult.Unknown],
        [EngineId.Codex, CheckResult.Unknown],
      ],
    );
    assert.equal(fs.existsSync(given.layout.root), false);
  });

  const otherHomes: Array<[string, string]> = [
    ["CLAUDE_CONFIG_DIR", "/tmp/other-claude"],
    ["CODEX_HOME", "/tmp/other-codex"],
  ];
  for (const [variable, value] of otherHomes)
    it(`fails the home-env check when ${variable} names another home, as campaign run would refuse`, async () => {
      const root = tempDir();
      const env: NodeJS.ProcessEnv = { [variable]: value };
      const lines: string[] = [];
      const code = await doctorCommand([], (line) => lines.push(line), deps(root, { env }));
      assert.equal(code, DOCTOR_EXIT_FAILED);
      assert.match(lines.join("\n"), new RegExp(`^fail {4}home-env: refused other-cli-home ${variable}$`, "m"));
      assert.deepEqual(env, { [variable]: value }, "nothing is half-applied");
    });
});
