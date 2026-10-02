/**
 * A fresh-machine profile: a live development launch that meets the app as a new Mac account does,
 * with no Claude Code, no Codex and no sign-in to borrow.
 *
 * The app finds the coding CLIs through the home folder (the login shell's PATH, `~/.local/bin`,
 * nvm, …) and borrows `~/.claude` and `~/.codex` as the user's own sign-in, so the launch gets an
 * empty home of its own and the system PATH, and keeps nothing else from its caller but the
 * account basics. The Keychain is the one thing a home cannot hide, and should not: a new account
 * has a login keychain too, and macOS finds it through HOME, so the fresh home links the account's
 * `Library/Keychains` (without it macOS offers to reset the keychain). Claude Code names its item
 * after `CLAUDE_SECURESTORAGE_CONFIG_DIR` (else, with no `CLAUDE_CONFIG_DIR`, the owner's own
 * `Claude Code-credentials`), so the launch points that at a folder of the profile.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The PATH a new Mac account starts from, before any installer adds to it. */
export const FRESH_MACHINE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/** The login shell of a new Mac account. */
const FRESH_MACHINE_SHELL = "/bin/zsh";

/** What a fresh-machine launch keeps from its caller: the account basics every Mac account has. */
const KEPT = new Set(["USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "__CF_USER_TEXT_ENCODING"]);
const KEPT_PREFIX = /^LC_/;

/** The folders a fresh-machine profile owns in place of the account's home. */
export type FreshMachineRoots = { home: string; secureStorage: string };

/** The environment of a fresh-machine launch or shell, built from `source` without changing it. */
export function freshMachineEnv(
  source: Record<string, string | undefined>,
  roots: FreshMachineRoots,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source))
    if (value !== undefined && (KEPT.has(key) || KEPT_PREFIX.test(key))) env[key] = value;
  return {
    ...env,
    HOME: roots.home,
    PATH: FRESH_MACHINE_PATH,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: roots.secureStorage,
  };
}

/**
 * Give the fresh home the account's keychains, as a link: removing the profile removes the link,
 * never the keychains. A `Keychains` already there is left alone.
 */
export function linkKeychains(home: string, accountHome: string = os.userInfo().homedir): void {
  const library = path.join(home, "Library");
  fs.mkdirSync(library, { recursive: true, mode: 0o700 });
  const link = path.join(library, "Keychains");
  const present = fs.lstatSync(link, { throwIfNoEntry: false });
  if (!present) fs.symlinkSync(path.join(accountHome, "Library", "Keychains"), link);
}

/** A recognized studio:dev profile, as `validateProfile` returns it. */
type Owner = { freshMachine?: boolean; home?: string; secureStorage?: string };

/**
 * How to open the profile's own terminal: where the tester installs and signs in as the new account.
 * Node can be installed for the whole Mac (`/usr/local`), so `npm install -g` here goes to the
 * profile's `~/.npm-global`, a folder the app searches; Homebrew installs for the whole Mac and
 * has no such switch.
 */
export function freshMachineShell(owner: Owner, source: Record<string, string | undefined>) {
  if (!owner.freshMachine || !owner.home || !owner.secureStorage) throw new Error("not a fresh-machine profile");
  const roots = { home: owner.home, secureStorage: owner.secureStorage };
  const env = { ...freshMachineEnv(source, roots), NPM_CONFIG_PREFIX: path.join(owner.home, ".npm-global") };
  return { file: FRESH_MACHINE_SHELL, args: ["-l"], cwd: owner.home, env };
}
