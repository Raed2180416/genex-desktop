/**
 * Electron names the data folder after the app, so the rename to Genex would leave the real
 * profile behind in `<appData>/AI Game Studio`. At startup the normal profile moves it to
 * `<appData>/Genex` when that folder is missing or empty; it never merges into data that is
 * already there, and never touches a developer, fixture or test profile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LEGACY_APP_NAME,
  migrateLegacyUserData,
  UserDataMigrationOutcome,
  type UserDataFs,
} from "../../src/main/user-data-migration.ts";

const APP_DATA = "/Users/someone/Library/Application Support";
const LEGACY = path.join(APP_DATA, LEGACY_APP_NAME);
const CURRENT = path.join(APP_DATA, "Genex");
const NORMAL = { appData: APP_DATA, userData: CURRENT, appName: "Genex", isolated: false };

/** Folders as `dir -> entries`, the calls that changed them, and the operations told to fail. */
function fakeFs(folders: Record<string, string[]>, fail: { rename?: string[]; copy?: boolean } = {}) {
  const dirs = new Map(Object.entries(folders));
  const calls: string[] = [];
  const fs: UserDataFs = {
    entries: (dir) => dirs.get(dir) ?? null,
    rename(from, to) {
      calls.push(`rename ${from} -> ${to}`);
      if (fail.rename?.includes(from)) throw new Error("EXDEV: cross-device link not permitted");
      dirs.set(to, dirs.get(from) ?? []);
      dirs.delete(from);
    },
    copy(from, to) {
      calls.push(`copy ${from} -> ${to}`);
      if (fail.copy) throw new Error("ENOSPC: no space left on device");
      dirs.set(to, [...(dirs.get(from) ?? [])]);
    },
    remove(dir) {
      calls.push(`remove ${dir}`);
      dirs.delete(dir);
    },
  };
  return { fs, dirs, calls };
}

test("the legacy profile moves to the new folder when only the legacy one exists", () => {
  const f = fakeFs({ [LEGACY]: ["studio.db", "secrets"] });
  const result = migrateLegacyUserData(NORMAL, f.fs);
  assert.deepEqual(result, { outcome: UserDataMigrationOutcome.Moved, from: LEGACY, to: CURRENT });
  assert.deepEqual(f.dirs.get(CURRENT), ["studio.db", "secrets"]);
  assert.equal(f.dirs.has(LEGACY), false);
});

test("an empty new folder (Electron may have made it) is replaced by the legacy profile", () => {
  const f = fakeFs({ [LEGACY]: ["studio.db"], [CURRENT]: [] });
  assert.equal(migrateLegacyUserData(NORMAL, f.fs).outcome, UserDataMigrationOutcome.Moved);
  assert.deepEqual(f.dirs.get(CURRENT), ["studio.db"]);
});

const noOps: Array<[string, Record<string, string[]>, typeof NORMAL, UserDataMigrationOutcome]> = [
  [
    "new data is already there",
    { [LEGACY]: ["old.db"], [CURRENT]: ["new.db"] },
    NORMAL,
    UserDataMigrationOutcome.NewDataPresent,
  ],
  ["neither folder exists", {}, NORMAL, UserDataMigrationOutcome.NoLegacyData],
  ["the legacy folder is empty", { [LEGACY]: [] }, NORMAL, UserDataMigrationOutcome.NoLegacyData],
  [
    "a developer, fixture or test profile",
    { [LEGACY]: ["old.db"] },
    { ...NORMAL, isolated: true },
    UserDataMigrationOutcome.Isolated,
  ],
  [
    "userData was pointed elsewhere (--user-data-dir)",
    { [LEGACY]: ["old.db"] },
    { ...NORMAL, userData: "/tmp/elsewhere" },
    UserDataMigrationOutcome.CustomLocation,
  ],
  [
    "the app still carries the legacy name",
    { [LEGACY]: ["old.db"] },
    { ...NORMAL, appName: LEGACY_APP_NAME, userData: LEGACY },
    UserDataMigrationOutcome.NoLegacyData,
  ],
];
for (const [name, folders, where, outcome] of noOps) {
  test(`nothing moves when ${name}`, () => {
    const f = fakeFs(folders);
    assert.deepEqual(migrateLegacyUserData(where, f.fs), { outcome });
    assert.deepEqual(f.calls, [], "no folder was renamed, copied or removed");
    assert.deepEqual(Object.fromEntries(f.dirs), folders);
  });
}

test("when the rename fails, the profile is copied through a staging folder and the legacy one kept", () => {
  const f = fakeFs({ [LEGACY]: ["studio.db"] }, { rename: [LEGACY] });
  const result = migrateLegacyUserData(NORMAL, f.fs);
  assert.equal(result.outcome, UserDataMigrationOutcome.Copied);
  assert.match(result.error ?? "", /EXDEV/);
  assert.deepEqual(f.dirs.get(CURRENT), ["studio.db"]);
  assert.deepEqual(f.dirs.get(LEGACY), ["studio.db"], "the legacy profile stays as it was");
});

test("when the copy fails too, nothing half-copied is left where the next launch would read it", () => {
  const f = fakeFs({ [LEGACY]: ["studio.db"] }, { rename: [LEGACY], copy: true });
  const result = migrateLegacyUserData(NORMAL, f.fs);
  assert.equal(result.outcome, UserDataMigrationOutcome.Failed);
  assert.match(result.error ?? "", /ENOSPC/);
  assert.equal(f.dirs.has(CURRENT), false, "the next launch tries again");
  assert.deepEqual([...f.dirs.keys()], [LEGACY]);
});

test("on disk: the default filesystem moves a real legacy profile, contents and all", async () => {
  const appData = await mkdtemp(path.join(os.tmpdir(), "studio-user-data-"));
  try {
    const legacy = path.join(appData, LEGACY_APP_NAME);
    await mkdir(path.join(legacy, "secrets"), { recursive: true });
    await writeFile(path.join(legacy, "secrets", "genex.bin"), "cipher");
    const userData = path.join(appData, "Genex");
    const result = migrateLegacyUserData({ appData, userData, appName: "Genex", isolated: false });
    assert.equal(result.outcome, UserDataMigrationOutcome.Moved);
    assert.equal(await readFile(path.join(userData, "secrets", "genex.bin"), "utf8"), "cipher");
    assert.deepEqual(await readdir(appData), ["Genex"]);
  } finally {
    await rm(appData, { recursive: true, force: true });
  }
});
