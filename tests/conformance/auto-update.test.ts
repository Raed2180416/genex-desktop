/**
 * Auto-update checks update.electronjs.org only from a released build: packaged, on a platform
 * that service serves (macOS, Windows), outside developer and test launches, and only once the
 * release switch is on (it stays off until the repository is public). A downloaded update is
 * announced in the studio window, which offers the restart; before the studio is up it is one
 * notification that restarts the app when clicked. The restart asks first while a run is active.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import { UpdateAction, UpdateCheckStatus } from "../../src/shared/app-update.ts";
import {
  AUTO_UPDATE_ENABLED,
  InstallCheck,
  UpdateMode,
  askUpdater,
  createUpdateChecker,
  updateCheckNote,
  UPDATE_REPO,
  type UpdateAnnouncerDeps,
  type UpdateCheckerDeps,
  type UpdateLaunch,
  UpdateSkip,
  autoUpdateDecision,
  createUpdateAnnouncer,
  releaseVersion,
} from "../../src/main/auto-update.ts";

import { ReleaseCheckKind } from "../../src/main/release-check.ts";

const require = createRequire(import.meta.url);

const released: UpdateLaunch = {
  enabled: true,
  packaged: true,
  platform: "darwin",
  developerLaunch: false,
  testLaunch: false,
  productName: "Genex",
};

test("a renamed fork cannot consume the official update feed", () => {
  assert.deepEqual(autoUpdateDecision({ ...released, productName: "My Studio" }), {
    start: false,
    reason: "identity",
  });
});

test("a released macOS or Windows build installs updates; a Linux build is told about them", () => {
  assert.deepEqual(autoUpdateDecision(released), { start: true, mode: UpdateMode.Install });
  assert.deepEqual(autoUpdateDecision({ ...released, platform: "win32" }), { start: true, mode: UpdateMode.Install });
  assert.deepEqual(autoUpdateDecision({ ...released, platform: "linux" }), { start: true, mode: UpdateMode.Notify });
});

test("every other launch stays off, and says why", () => {
  const cases: [Partial<UpdateLaunch>, UpdateSkip][] = [
    [{ enabled: false }, UpdateSkip.Disabled],
    [{ packaged: false }, UpdateSkip.Unpackaged],
    [{ platform: "freebsd" }, UpdateSkip.Platform],
    [{ developerLaunch: true }, UpdateSkip.DeveloperLaunch],
    [{ testLaunch: true }, UpdateSkip.TestLaunch],
  ];
  for (const [change, reason] of cases) {
    assert.deepEqual(autoUpdateDecision({ ...released, ...change }), { start: false, reason }, JSON.stringify(change));
  }
});

test("the release switch is on, so a released build checks for updates", () => {
  assert.equal(AUTO_UPDATE_ENABLED, true);
  assert.deepEqual(autoUpdateDecision({ ...released, enabled: AUTO_UPDATE_ENABLED }), {
    start: true,
    mode: UpdateMode.Install,
  });
});

test("the update feed reads the repository the releases are published to", () => {
  const forge = require("../../forge.config.cjs");
  const github = forge.publishers.find(
    (publisher: { name: string }) => publisher.name === "@electron-forge/publisher-github",
  );
  const { owner, name } = github.config.repository;
  assert.equal(`${owner}/${name}`, UPDATE_REPO, "forge.config.cjs publishers");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.repository.url, `git+https://github.com/${UPDATE_REPO}.git`, "package.json repository");
});

test("the version comes from the release's name, whatever the feed calls it", () => {
  const cases: [string, string | null][] = [
    // update.electronjs.org answers with the GitHub release's title, which release.yml writes so.
    ["Genex 0.2.0", "0.2.0"],
    ["v0.2.0", "0.2.0"],
    // Squirrel.Windows names the bare version.
    ["0.3.0-rc.2", "0.3.0-rc.2"],
    ["", null],
    ["Spring release", null],
  ];
  for (const [name, version] of cases) assert.equal(releaseVersion(name), version, name);
});

/** An announcer over recorders: what it told whom, and the clicks its notifications wait on. */
function announcer(change: Partial<UpdateAnnouncerDeps> = {}) {
  const log: string[] = [];
  const clicks: (() => void)[] = [];
  const updates = createUpdateAnnouncer({
    studioUp: () => true,
    announce: (update) => log.push(`announce ${update.version}`),
    notify: (note, onClick) => {
      log.push(`notify ${note.title}: ${note.body}`);
      clicks.push(onClick);
    },
    confirmRestart: async () => true,
    quitAndInstall: () => log.push("quit and install"),
    openRelease: (url) => log.push(`open ${url}`),
    ...change,
  });
  return { updates, log, clicks };
}

test("a downloaded update is announced in the studio window and waits there for a restart", () => {
  const { updates, log } = announcer();
  assert.equal(updates.ready(), null);
  updates.downloaded("Genex 0.2.0");
  assert.deepEqual(updates.ready(), { version: "0.2.0", action: UpdateAction.Restart });
  assert.deepEqual(log, ["announce 0.2.0"], "no notification while the window can say it");
});

test("before the studio is up, the update is one notification that names the version once", async () => {
  const { updates, log, clicks } = announcer({ studioUp: () => false });
  updates.downloaded("Genex 0.2.0");
  assert.deepEqual(log, [
    "notify Update ready — restart: Genex 0.2.0 is downloaded. Click to restart now, or it installs the next time you quit.",
  ]);
  clicks[0]?.();
  await setImmediate();
  assert.deepEqual(log.slice(1), ["quit and install"], "the click restarts into it");
  const unnamed = announcer({ studioUp: () => false });
  unnamed.updates.downloaded("");
  assert.deepEqual(unnamed.log, [
    "notify Update ready — restart: A new version of Genex is downloaded. Click to restart now, or it installs the next time you quit.",
  ]);
});

test("restart installs only a downloaded update, and only once the person agrees", async () => {
  let agree = false;
  const { updates, log } = announcer({ confirmRestart: async () => agree });
  assert.equal(await updates.restart(), false, "nothing downloaded");
  updates.downloaded("0.2.0");
  log.length = 0;
  assert.equal(await updates.restart(), false, "the person kept the run going");
  assert.deepEqual(log, []);
  agree = true;
  assert.equal(await updates.restart(), true);
  assert.deepEqual(log, ["quit and install"]);
});

test("a second restart while the first still asks does not ask again", async () => {
  let answer: (agree: boolean) => void = () => {};
  let asked = 0;
  const { updates, log } = announcer({
    confirmRestart: () => {
      asked++;
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  });
  updates.downloaded("0.2.0");
  log.length = 0;
  const first = updates.restart();
  assert.equal(await updates.restart(), false);
  answer(true);
  assert.equal(await first, true);
  assert.equal(asked, 1);
  assert.deepEqual(log, ["quit and install"]);
});

const PAGE = "https://github.com/genex-games/genex-desktop/releases/tag/v0.2.0";

test("a published release Linux cannot install is offered for download, once per version", async () => {
  const { updates, log } = announcer();
  updates.available({ version: "0.2.0", url: PAGE });
  updates.available({ version: "0.2.0", url: PAGE });
  assert.deepEqual(updates.ready(), { version: "0.2.0", action: UpdateAction.Download });
  assert.deepEqual(log, ["announce 0.2.0"], "a later check of the same release says nothing new");
  assert.equal(await updates.restart(), false, "nothing downloaded to install");
  assert.equal(updates.download(), true);
  assert.deepEqual(log.slice(1), [`open ${PAGE}`]);
});

test("before the studio is up, a downloadable release is one notification that opens its page", () => {
  const { updates, log, clicks } = announcer({ studioUp: () => false });
  updates.available({ version: "0.2.0", url: PAGE });
  assert.deepEqual(log, ["notify Genex 0.2.0 is available: Click to open its download page."]);
  clicks[0]?.();
  assert.deepEqual(log.slice(1), [`open ${PAGE}`]);
});

test("download opens nothing while no downloadable release waits", () => {
  const { updates, log } = announcer();
  assert.equal(updates.download(), false);
  updates.downloaded("Genex 0.2.0");
  assert.equal(updates.download(), false, "a downloaded update installs by restart, not a page");
  assert.deepEqual(log, ["announce 0.2.0"]);
});

/** A stand-in for Electron's autoUpdater: records checks and lets a test emit its events. */
function fakeUpdater(onCheck: (emit: (event: string) => void) => void = () => {}) {
  type Listener = (() => void) & { original?: () => void };
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener();
  };
  let checks = 0;
  const updater = {
    once(event: string, listener: () => void) {
      const wrapped: Listener = () => {
        listeners.get(event)?.delete(wrapped);
        listener();
      };
      wrapped.original = listener;
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(wrapped);
      return updater;
    },
    removeListener(event: string, listener: () => void) {
      for (const held of [...(listeners.get(event) ?? [])]) {
        if (held === listener || held.original === listener) listeners.get(event)?.delete(held);
      }
      return updater;
    },
    checkForUpdates() {
      checks++;
      onCheck(emit);
    },
  };
  const listening = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { updater, emit, checks: () => checks, listening };
}

test("asking the installer maps each answer of the updater, and leaves no listener behind", async () => {
  const cases: [string, InstallCheck][] = [
    ["update-not-available", InstallCheck.None],
    ["update-available", InstallCheck.Found],
    ["update-downloaded", InstallCheck.Downloaded],
    ["error", InstallCheck.Failed],
  ];
  for (const [event, expected] of cases) {
    const fake = fakeUpdater((emit) => emit(event));
    assert.equal(await askUpdater(fake.updater, { timeoutMs: 1000 }), expected, event);
    assert.equal(fake.listening(), 0, event);
  }
});

test("an updater that never answers, or throws, fails the check instead of hanging", async () => {
  const silent = fakeUpdater();
  assert.equal(await askUpdater(silent.updater, { timeoutMs: 5 }), InstallCheck.Failed);
  assert.equal(silent.listening(), 0);
  const throwing = fakeUpdater(() => {
    throw new Error("Update URL is not set");
  });
  assert.equal(await askUpdater(throwing.updater, { timeoutMs: 1000 }), InstallCheck.Failed);
  assert.equal(throwing.listening(), 0);
});

/** A checker over an announcer, a scripted installer and a scripted release check. */
function checker(
  decision: ReturnType<typeof autoUpdateDecision>,
  answers: { install?: InstallCheck; release?: Awaited<ReturnType<UpdateCheckerDeps["latestRelease"]>> } = {},
) {
  const rig = announcer();
  let asked = 0;
  const { check } = createUpdateChecker({
    decision,
    current: "0.1.0",
    updates: rig.updates,
    askInstaller: async () => {
      asked++;
      return answers.install ?? InstallCheck.None;
    },
    latestRelease: async () => {
      asked++;
      return answers.release ?? { kind: ReleaseCheckKind.Current };
    },
  });
  return { check, rig, asked: () => asked };
}

test("check for updates on macOS: current, downloading, or the update already waiting", async () => {
  const install = { start: true, mode: UpdateMode.Install } as const;
  const current = await checker(install).check();
  assert.deepEqual(current, { status: UpdateCheckStatus.Current, current: "0.1.0", update: null });
  const found = await checker(install, { install: InstallCheck.Found }).check();
  assert.equal(found.status, UpdateCheckStatus.Downloading);
  const failed = await checker(install, { install: InstallCheck.Failed }).check();
  assert.equal(failed.status, UpdateCheckStatus.Failed);
  const waiting = checker(install);
  waiting.rig.updates.downloaded("Genex 0.2.0");
  assert.deepEqual(await waiting.check(), {
    status: UpdateCheckStatus.Waiting,
    current: "0.1.0",
    update: { version: "0.2.0", action: UpdateAction.Restart },
  });
  assert.equal(waiting.asked(), 0, "nothing to ask while a download waits");
});

test("check for updates on Linux finds the release and offers its download", async () => {
  const notify = { start: true, mode: UpdateMode.Notify } as const;
  const { check, rig } = checker(notify, {
    release: { kind: ReleaseCheckKind.Newer, release: { version: "0.2.0", url: PAGE } },
  });
  assert.deepEqual(await check(), {
    status: UpdateCheckStatus.Waiting,
    current: "0.1.0",
    update: { version: "0.2.0", action: UpdateAction.Download },
  });
  assert.deepEqual(rig.log, ["announce 0.2.0"]);
  const failed = checker(notify, { release: { kind: ReleaseCheckKind.Failed, reason: "offline" } });
  assert.equal((await failed.check()).status, UpdateCheckStatus.Failed);
});

test("a build that never checks answers off without asking anyone, unless an update already waits", async () => {
  const { check, asked, rig } = checker({ start: false, reason: UpdateSkip.DeveloperLaunch });
  assert.deepEqual(await check(), { status: UpdateCheckStatus.Off, current: "0.1.0", update: null });
  assert.equal(asked(), 0);
  rig.updates.downloaded("Genex 0.2.0");
  assert.equal((await check()).status, UpdateCheckStatus.Waiting, "the update-ready fixture's stand-in");
});

test("two checks at once ask once", async () => {
  const { check, asked } = checker({ start: true, mode: UpdateMode.Install });
  const [first, second] = await Promise.all([check(), check()]);
  assert.deepEqual(first, second);
  assert.equal(asked(), 1);
});

test("the menu's answer names the versions and offers the one next step", () => {
  const current = updateCheckNote({ status: UpdateCheckStatus.Current, current: "0.1.0", update: null });
  assert.equal(current.act, null);
  assert.match(current.message, /0\.1\.0/);
  const download = updateCheckNote({
    status: UpdateCheckStatus.Waiting,
    current: "0.1.0",
    update: { version: "0.2.0", action: UpdateAction.Download },
  });
  assert.equal(download.act, UpdateAction.Download);
  assert.match(download.message, /0\.2\.0/);
  const restart = updateCheckNote({
    status: UpdateCheckStatus.Waiting,
    current: "0.1.0",
    update: { version: "0.2.0", action: UpdateAction.Restart },
  });
  assert.equal(restart.act, UpdateAction.Restart);
  for (const status of [UpdateCheckStatus.Downloading, UpdateCheckStatus.Off, UpdateCheckStatus.Failed]) {
    assert.equal(updateCheckNote({ status, current: "0.1.0", update: null }).act, null, status);
  }
});
