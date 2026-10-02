import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  freshMachineEnv,
  freshMachineShell,
  FRESH_MACHINE_PATH,
  linkKeychains,
} from "../../scripts/studio-dev/fresh-machine.ts";
import {
  allocateProfile,
  freshMachineHome,
  removeProfile,
  validateProfile,
} from "../../scripts/studio-dev/ownership.mjs";
import { parseStudioDevArgs } from "../../scripts/studio-dev/args.ts";
import { standardCliDirs } from "../../src/substrate/engines/external-cli.ts";
import { tmpDir } from "../helpers/tmp.ts";

/** Fresh-machine homes live in the temporary folder, outside any checkout: remove the ones made here. */
const homes: string[] = [];
after(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});
/** A fresh-machine profile in `checkout`, its home removed when the file ends. */
function freshProfile(checkout: string, id = "newbie") {
  const owner = allocateProfile(checkout, id, "live", null, false, true);
  homes.push(owner.home);
  return owner;
}

const REAL_HOME = "/Users/owner";
const ROOTS = {
  home: "/private/var/folders/xy/T/genex-fresh-machine/5f0c2a4e-0000-4000-8000-000000000001",
  secureStorage: "/work/.studio-dev/profiles/newbie/secure-storage-1",
};

// What an agent session or a developer's shell hands a launch: its own home, CLIs on PATH, sign-in
// homes, credentials, and the variables that point a shell or a CLI back at the real account.
const HOSTILE: Record<string, string> = {
  HOME: REAL_HOME,
  PATH: `${REAL_HOME}/.local/bin:${REAL_HOME}/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin`,
  ZDOTDIR: `${REAL_HOME}/.config/zsh`,
  XDG_CONFIG_HOME: `${REAL_HOME}/.config`,
  NVM_DIR: `${REAL_HOME}/.nvm`,
  VOLTA_HOME: `${REAL_HOME}/.volta`,
  BUN_INSTALL: `${REAL_HOME}/.bun`,
  npm_config_prefix: `${REAL_HOME}/.npm-global`,
  CLAUDE_CONFIG_DIR: `${REAL_HOME}/.claude`,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: `${REAL_HOME}/.claude`,
  CODEX_HOME: `${REAL_HOME}/.codex`,
  ANTHROPIC_API_KEY: "synthetic-anthropic-key",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9/host-proxy",
  CLAUDE_CODE_OAUTH_TOKEN: "synthetic-oauth",
  CLAUDE_CODE_OAUTH_SCOPES: "user:inference",
  CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
  CLAUDECODE: "1",
  OPENAI_API_KEY: "synthetic-openai-key",
  CODEX_API_KEY: "synthetic-codex-key",
  GENEX_TOKEN: "synthetic-genex",
  STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS: "1",
  ELECTRON_RUN_AS_NODE: "1",
  USER: "owner",
  LOGNAME: "owner",
  SHELL: "/bin/zsh",
  TMPDIR: "/var/folders/xy/T/",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0",
};

// The whole of what a fresh-machine launch keeps from its caller: a new Mac account has these too.
const KEPT = ["USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "__CF_USER_TEXT_ENCODING"];

test("a fresh-machine launch sees an empty home, the system PATH and none of the caller's sign-ins", () => {
  const env = freshMachineEnv(HOSTILE, ROOTS);
  assert.equal(env.HOME, ROOTS.home);
  assert.equal(env.PATH, FRESH_MACHINE_PATH);
  // Claude Code names its Keychain item after this folder; unset, it would read the owner's own.
  assert.equal(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, ROOTS.secureStorage);
  for (const key of KEPT) assert.equal(env[key], HOSTILE[key], key);
  assert.deepEqual(Object.keys(env).sort(), [...KEPT, "HOME", "PATH", "CLAUDE_SECURESTORAGE_CONFIG_DIR"].sort());
  for (const [key, value] of Object.entries(env))
    assert.ok(!String(value).startsWith(REAL_HOME), `${key} points into the real home: ${value}`);
  assert.equal(HOSTILE.CLAUDE_CODE_OAUTH_TOKEN, "synthetic-oauth", "caller environment is unchanged");
});

test("no folder the app searches for a coding CLI leads back into the real home", async () => {
  const env = freshMachineEnv(HOSTILE, ROOTS);
  const searched = [...String(env.PATH).split(":"), ...(await standardCliDirs(String(env.HOME), "darwin", env))];
  const intoRealHome = searched.filter((dir) => dir === REAL_HOME || dir.startsWith(`${REAL_HOME}/`));
  assert.deepEqual(intoRealHome, []);
});

test("a fresh-machine profile is live, disposable, with an empty home outside the checkout", async () => {
  const checkout = await tmpDir("fresh-machine-");
  assert.throws(() => allocateProfile(checkout, "fixture-fresh", "fixture", "app-basics", false, true), /live/);
  const owner = freshProfile(checkout);
  assert.equal(owner.freshMachine, true);
  assert.equal(owner.retention, "disposable");
  // The app never takes a coding CLI from inside its own checkout, and the CLIs install into this home.
  assert.equal(owner.home, freshMachineHome(owner.ownerId));
  assert.equal(owner.home.startsWith(`${fs.realpathSync(checkout)}${path.sep}`), false);
  assert.deepEqual(fs.readdirSync(owner.home), []);
  assert.equal(owner.secureStorage, path.join(owner.root, `secure-storage-${owner.ownerId}`));
  assert.ok(fs.statSync(owner.secureStorage).isDirectory());
  assert.equal(validateProfile(checkout, "newbie").ownerId, owner.ownerId);
  assert.throws(() => allocateProfile(checkout, "newbie", "live", null, true, false), /reuse cannot change/);
  assert.equal(allocateProfile(checkout, "newbie", "live", null, true, true).ownerId, owner.ownerId);

  const plain = allocateProfile(checkout, "plain-live", "live", null);
  assert.equal(plain.retention, "retained");
  assert.equal("freshMachine" in plain, false);
  assert.equal("home" in plain, false);
  assert.throws(() => freshMachineHome("../../Users/owner"), /invalid owner id/);
});

test("a fresh-machine profile whose recorded home points elsewhere is refused", async () => {
  const checkout = await tmpDir("fresh-machine-");
  const owner = freshProfile(checkout);
  const file = path.join(owner.root, "owner.json");
  for (const tampered of [
    { home: REAL_HOME },
    { home: path.join(owner.root, "home") },
    { home: path.join(path.dirname(owner.home), "5f0c2a4e-0000-4000-8000-000000000002") },
    { secureStorage: `${REAL_HOME}/.claude` },
    { retention: "retained" },
  ]) {
    fs.writeFileSync(file, JSON.stringify({ ...owner, ...tampered }));
    assert.throws(() => validateProfile(checkout, "newbie"), JSON.stringify(tampered));
  }
});

test("the fresh-machine shell is the profile's login zsh in its home, and only a fresh-machine profile has one", async () => {
  const checkout = await tmpDir("fresh-machine-");
  const owner = freshProfile(checkout);
  const shell = freshMachineShell(owner, HOSTILE);
  assert.equal(shell.file, "/bin/zsh");
  assert.deepEqual(shell.args, ["-l"]);
  assert.equal(shell.cwd, owner.home);
  // Node may be installed for the whole Mac: a global npm install from this shell stays in the profile.
  assert.deepEqual(shell.env, {
    ...freshMachineEnv(HOSTILE, { home: owner.home, secureStorage: owner.secureStorage }),
    NPM_CONFIG_PREFIX: path.join(owner.home, ".npm-global"),
  });
  const plain = allocateProfile(checkout, "plain-live", "live", null);
  assert.throws(() => freshMachineShell(plain, HOSTILE), /not a fresh-machine profile/);
});

test("start takes --fresh-machine and shell takes a profile", () => {
  assert.equal(
    parseStudioDevArgs(["start", "--profile", "p", "--providers", "live", "--fresh-machine"]).freshMachine,
    true,
  );
  assert.equal("freshMachine" in parseStudioDevArgs(["start", "--profile", "p"]), false);
  assert.deepEqual(parseStudioDevArgs(["shell", "--profile", "p"]), { command: "shell", profile: "p", reuse: false });
});

test("the fresh home reaches the account's keychains through a link, and throwing the profile away leaves them", async () => {
  const account = await tmpDir("fresh-machine-account-");
  const keychains = path.join(account, "Library", "Keychains");
  fs.mkdirSync(keychains, { recursive: true });
  fs.writeFileSync(path.join(keychains, "login.keychain-db"), "the owner's keychain");
  const checkout = await tmpDir("fresh-machine-");
  const owner = freshProfile(checkout);
  linkKeychains(owner.home, account);
  linkKeychains(owner.home, account);
  const link = path.join(owner.home, "Library", "Keychains");
  assert.equal(fs.readlinkSync(link), keychains);
  assert.equal(fs.readFileSync(path.join(link, "login.keychain-db"), "utf8"), "the owner's keychain");
  // `clean` removes the profile this way: the link goes, never what it points at.
  removeProfile(owner);
  assert.equal(fs.existsSync(owner.root), false);
  assert.equal(fs.existsSync(owner.home), false);
  assert.equal(fs.readFileSync(path.join(keychains, "login.keychain-db"), "utf8"), "the owner's keychain");
});

test("a Keychains folder already in the fresh home is left as it is", async () => {
  const checkout = await tmpDir("fresh-machine-");
  const owner = freshProfile(checkout);
  const own = path.join(owner.home, "Library", "Keychains");
  fs.mkdirSync(own, { recursive: true });
  linkKeychains(owner.home, await tmpDir("fresh-machine-account-"));
  assert.equal(fs.lstatSync(own).isSymbolicLink(), false);
});
