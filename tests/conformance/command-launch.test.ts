/**
 * Starting a Windows command script through cmd.exe, and ending a process tree on every platform.
 * The command-line tables run on any host; the cases marked Windows run a real `.cmd` and a real
 * `taskkill` on the Windows CI.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cmdArgument, commandLaunch, isCommandScript } from "../../src/substrate/command-launch.ts";
import { killProcessTree, treeKillCommand } from "../../src/substrate/process-tree.ts";

const WINDOWS = process.platform === "win32";
const ENV = { SystemRoot: "C:\\Windows" };
/** A command script that is not one of npm's shims (or cannot be read): it goes through cmd.exe. */
const NOT_A_SHIM = { readScript: () => null, exists: () => false };

/** npm's current cmd-shim, as `npm install -g` writes it (cmd-shim 4+). */
const NPM_SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
].join("\r\n");
/** The older shim npm wrote before cmd-shim 4. */
const OLD_NPM_SHIM = [
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ") ELSE (",
  "  @SETLOCAL",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ")",
].join("\r\n");

/**
 * Arguments that would run a command if cmd.exe parsed them twice with one escape: npm's shims
 * re-expand them through `%*`, where a `"` ends the quoting and `&` starts a new command.
 */
const HOSTILE_ARGUMENTS = [
  'x" & echo PWNED> "pwned.txt" & "',
  'a"&whoami',
  '"',
  '\\"&echo PWNED>pwned.txt',
  "%COMSPEC%",
  "!PATH!",
  "^",
  "a|b",
  "(x) & (y)",
  "<in >out",
  "50%",
  "back\\slash\\",
];

describe("starting a command script", () => {
  it("starts anything but a Windows script as it is", () => {
    assert.deepEqual(commandLaunch("/usr/local/bin/claude.cmd", ["--version"], "darwin", ENV), {
      file: "/usr/local/bin/claude.cmd",
      args: ["--version"],
      windowsVerbatimArguments: false,
    });
    assert.deepEqual(commandLaunch("C:\\bin\\claude.exe", ["--version"], "win32", ENV).file, "C:\\bin\\claude.exe");
    assert.equal(isCommandScript("C:\\npm\\codex.CMD", "win32"), true);
    assert.equal(isCommandScript("C:\\npm\\codex.bat", "win32"), true);
    assert.equal(isCommandScript("C:\\npm\\codex.ps1", "win32"), false);
  });

  it("starts one of npm's shims as node and its script, with no cmd.exe to parse the arguments", () => {
    const dir = "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm";
    const withoutLocalNode = { readScript: () => NPM_SHIM, exists: () => false };
    assert.deepEqual(commandLaunch(`${dir}\\codex.cmd`, ["exec", 'say "hi" & bye'], "win32", ENV, withoutLocalNode), {
      file: "node",
      args: [`${dir}\\node_modules\\@openai\\codex\\bin\\codex.js`, "exec", 'say "hi" & bye'],
      windowsVerbatimArguments: false,
    });
    const withLocalNode = { readScript: () => NPM_SHIM, exists: (file: string) => file === `${dir}\\node.exe` };
    assert.equal(commandLaunch(`${dir}\\codex.cmd`, [], "win32", ENV, withLocalNode).file, `${dir}\\node.exe`);
    const oldShim = { readScript: () => OLD_NPM_SHIM, exists: () => false };
    assert.deepEqual(commandLaunch(`${dir}\\claude.cmd`, ["-p"], "win32", ENV, oldShim).args, [
      `${dir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
      "-p",
    ]);
  });

  it("runs any other .cmd through cmd.exe by its full path: a plain word bare, anything else escaped for both parses", () => {
    const launch = commandLaunch(
      "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd",
      ["-c", 'forced_login_method="chatgpt"', "login"],
      "win32",
      ENV,
      NOT_A_SHIM,
    );
    assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
    assert.equal(launch.windowsVerbatimArguments, true);
    assert.deepEqual(launch.args.slice(0, 4), ["/d", "/v:off", "/s", "/c"]);
    assert.equal(
      launch.args[4],
      '""C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd" -c ^^^"forced_login_method=\\^^^"chatgpt\\^^^"^^^" login"',
    );
  });

  it("passes a plain word bare, the same after one parse or two, and escapes every other argument twice", () => {
    const line = (args: string[]) => commandLaunch("C:\\tools\\x.cmd", args, "win32", ENV, NOT_A_SHIM).args[4];
    assert.equal(
      line(["--version", "C:\\Users\\Ada\\file.txt", "a.b+c@d"]),
      '""C:\\tools\\x.cmd" --version C:\\Users\\Ada\\file.txt a.b+c@d"',
    );
    // A cmd delimiter (space, =, comma, semicolon) or metacharacter, or nothing at all, is quoted.
    for (const arg of ["a b", "k=v", "a,b", "a;b", "a&b", "", "^", "%x%"])
      assert.equal(line([arg]), `""C:\\tools\\x.cmd" ${cmdArgument(arg, { twice: true })}"`, JSON.stringify(arg));
  });

  it("escapes a script argument twice, since the script re-expands it through %*", () => {
    assert.equal(cmdArgument("a&b", { twice: true }), '^^^"a^^^&b^^^"');
    assert.equal(cmdArgument('a"&whoami', { twice: true }), '^^^"a\\^^^"^^^&whoami^^^"');
  });

  it("quotes an argument the way the C runtime reads it back", () => {
    assert.equal(cmdArgument("plain"), '^"plain^"');
    assert.equal(cmdArgument("a b"), '^"a^ b^"');
    assert.equal(cmdArgument("a&b|c>d"), '^"a^&b^|c^>d^"');
    assert.equal(cmdArgument("trailing\\"), '^"trailing\\\\^"');
    assert.equal(cmdArgument('x\\"y'), '^"x\\\\\\^"y^"');
  });

  it("escapes what cmd.exe would expand, so a variable or a bang arrives as written", () => {
    assert.equal(cmdArgument("%USERPROFILE%"), '^"^%USERPROFILE^%^"');
    assert.equal(cmdArgument("!PATH!"), '^"^!PATH^!^"');
    assert.doesNotThrow(() => commandLaunch("C:\\a!b\\x.cmd", [], "win32", ENV), "delayed expansion is off (/v:off)");
  });

  const hostile: Array<[string, string, string[]]> = [
    ["a percent in the script path", "C:\\%PATH%\\x.cmd", []],
    ["a quote in the script path", 'C:\\a"b\\x.cmd', []],
    ["a line break in an argument", "C:\\x.cmd", ["a\r\nb"]],
    ["a NUL in an argument", "C:\\x.cmd", ["a\0b"]],
  ];
  for (const [name, file, args] of hostile) {
    it(`refuses ${name}, starting nothing`, () => {
      assert.throws(() => commandLaunch(file, args, "win32", ENV), /Refusing/);
    });
  }

  it("hands a real .cmd the exact arguments, in a folder with spaces and parentheses", {
    skip: !WINDOWS && "Windows cmd.exe only",
  }, async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), "cmd launch ")), "Program Files (x86)");
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, "argv.json");
    const script = path.join(dir, "echo-args.js");
    await writeFile(
      script,
      `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    const shim = path.join(dir, "tool.cmd");
    await writeFile(shim, `@ECHO off\r\n"${process.execPath}" "%~dp0\\echo-args.js" %*\r\n`);
    const args = [
      "-c",
      'forced_login_method="chatgpt"',
      "a b",
      "a&b",
      "(x)",
      "back\\slash\\",
      "%USERPROFILE%",
      "!PATH!",
      "50%",
    ];
    const launch = commandLaunch(shim, args);
    const run = spawnSync(launch.file, launch.args, { windowsVerbatimArguments: launch.windowsVerbatimArguments });
    assert.equal(run.status, 0, String(run.stderr));
    assert.deepEqual(JSON.parse(await readFile(out, "utf8")), args);
  });

  // A script that reads its own arguments (`%~1`) sees them after one parse: the packaged smoke's
  // CLI fixture, which a doubly escaped plain word no longer matched.
  it("hands a script that reads %~1 itself its plain arguments as written", {
    skip: !WINDOWS && "Windows cmd.exe only",
  }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cmd direct "));
    const script = path.join(dir, "tool.cmd");
    await writeFile(
      script,
      [
        "@echo off",
        'if "%~1"=="--version" echo version-seen',
        'if "%~1"=="exec" if "%~2"=="--json" echo exec-json-seen',
        "exit /b 0",
        "",
      ].join("\r\n"),
    );
    for (const [args, expected] of [
      [["--version"], "version-seen"],
      [["exec", "--json"], "exec-json-seen"],
    ] as const) {
      const launch = commandLaunch(script, [...args]);
      const run = spawnSync(launch.file, launch.args, { windowsVerbatimArguments: launch.windowsVerbatimArguments });
      assert.equal(run.status, 0, String(run.stderr));
      assert.equal(String(run.stdout).trim(), expected);
    }
  });

  // The attack the security review found: an argument that closes cmd's quoting on the shim's
  // second parse and chains a command. It must arrive as written and run nothing.
  for (const [name, shimText] of [
    ["a plain script that forwards %*", (node: string) => `@ECHO off\r\n"${node}" "%~dp0\\echo-args.js" %*\r\n`],
    ["one of npm's shims", () => NPM_SHIM.replace("node_modules\\@openai\\codex\\bin\\codex.js", "echo-args.js")],
  ] as const) {
    it(`hands ${name} hostile arguments as written, running nothing they spell`, {
      skip: !WINDOWS && "Windows cmd.exe only",
    }, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "cmd hostile "));
      const out = path.join(dir, "argv.json");
      await writeFile(
        path.join(dir, "echo-args.js"),
        `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`,
      );
      const shim = path.join(dir, "tool.cmd");
      await writeFile(shim, shimText(process.execPath));
      const launch = commandLaunch(shim, HOSTILE_ARGUMENTS);
      const run = spawnSync(launch.file, launch.args, {
        cwd: dir,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
      assert.equal(run.status, 0, String(run.stderr));
      assert.deepEqual(JSON.parse(await readFile(out, "utf8")), HOSTILE_ARGUMENTS);
      await assert.rejects(readFile(path.join(dir, "pwned.txt")), "no chained command ran");
      assert.doesNotMatch(String(run.stdout), /PWNED/);
    });
  }
});

describe("ending a process tree", () => {
  it("runs taskkill by its full path over the whole tree on Windows", async () => {
    const commands: unknown[] = [];
    await killProcessTree(4242, { platform: "win32", env: ENV, run: async (command) => void commands.push(command) });
    assert.deepEqual(commands, [{ file: "C:\\Windows\\System32\\taskkill.exe", args: ["/PID", "4242", "/T", "/F"] }]);
    assert.deepEqual(treeKillCommand(7, {}).file, "C:\\Windows\\System32\\taskkill.exe");
  });

  it("signals the process group on POSIX, or the process alone when it leads none", async () => {
    const sent: Array<[number, string]> = [];
    await killProcessTree(42, { platform: "darwin", kill: (pid, signal) => void sent.push([pid, signal]) });
    assert.deepEqual(sent, [[-42, "SIGKILL"]]);
    const fallback: Array<[number, string]> = [];
    await killProcessTree(43, {
      platform: "linux",
      signal: "SIGTERM",
      kill: (pid, signal) => {
        if (pid < 0) throw Object.assign(new Error("no group"), { code: "ESRCH" });
        fallback.push([pid, signal]);
      },
    });
    assert.deepEqual(fallback, [[43, "SIGTERM"]]);
    await killProcessTree(undefined, { platform: "win32", run: async () => assert.fail("no pid, no taskkill") });
  });

  it("ends a real child and the grandchild it started", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tree-kill-"));
    const pidFile = path.join(dir, "grandchild.pid");
    const grandchild = `setInterval(() => {}, 1000)`;
    const parent = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ["-e", parent], { stdio: "ignore", detached: !WINDOWS });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    let grandchildPid = 0;
    for (let i = 0; i < 500 && !grandchildPid; i++) {
      grandchildPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (!grandchildPid) await delay(10);
    }
    assert.ok(grandchildPid, "the grandchild started");
    await killProcessTree(child.pid);
    await exited;
    let alive = true;
    for (let i = 0; i < 300 && alive; i++) {
      try {
        process.kill(grandchildPid, 0);
        await delay(10);
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, "the grandchild ended with its parent");
  });
});
