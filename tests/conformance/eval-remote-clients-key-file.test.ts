/**
 * The ingest key file guard (scripts/evals/remote/key-file.ts, §20.1): a hostile-input table over
 * real temp folders and modes. Each refused file is left exactly as it was (content and mode), the
 * refusal names a code, and the key's value never appears in an error or in any printing of the
 * accepted key.
 */
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import { EVALS_HOME_ENV } from "../../scripts/evals/home.ts";
import { EVALS_KEY_FILE_ENV } from "../../scripts/evals/remote/contract.ts";
import {
  KEY_FILE_MAX_BYTES,
  KeyFileError,
  KeyFileRefusal,
  keyFilePath,
  readIngestKey,
} from "../../scripts/evals/remote/key-file.ts";
import { tmpDir } from "../helpers/tmp.ts";

const BODY = "FAKEfakeFAKEfake0123456789";
const KEY = `genex_sk_v1_${BODY}`;
const posixOnly = process.platform === "win32" ? "POSIX file modes" : false;

interface Setup {
  /** The environment the reader gets. */
  env: Record<string, string>;
  /** The file whose content and mode must not change. */
  file: string;
}

async function keyAt(file: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  await chmod(file, mode);
}

async function refusedWith(env: Record<string, string>): Promise<KeyFileError> {
  const error = await readIngestKey(env).then(
    () => assert.fail("expected a refusal"),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof KeyFileError, String(error));
  return error;
}

/** Hostile key files: each is refused with its code. */
const HOSTILE_KEY_FILES: Array<{ name: string; code: KeyFileRefusal; setup: (root: string) => Promise<Setup> }> = [
  {
    name: "group-readable (0640)",
    code: KeyFileRefusal.TooOpen,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await keyAt(file, KEY, 0o640);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "world-readable (0604)",
    code: KeyFileRefusal.TooOpen,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await keyAt(file, KEY, 0o604);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "the default location, readable by all (0644)",
    code: KeyFileRefusal.TooOpen,
    setup: async (root) => {
      const file = path.join(root, "secrets", "genex-evals.key");
      await keyAt(file, KEY, 0o644);
      return { env: { [EVALS_HOME_ENV]: root }, file };
    },
  },
  {
    name: "inside a Git checkout",
    code: KeyFileRefusal.InsideGitWorktree,
    setup: async (root) => {
      await mkdir(path.join(root, "repo", ".git"), { recursive: true });
      const file = path.join(root, "repo", "config", "k.key");
      await keyAt(file, KEY);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "inside a linked worktree (a .git file)",
    code: KeyFileRefusal.InsideGitWorktree,
    setup: async (root) => {
      await mkdir(path.join(root, "wt"), { recursive: true });
      await writeFile(path.join(root, "wt", ".git"), "gitdir: /nowhere\n");
      const file = path.join(root, "wt", "k.key");
      await keyAt(file, KEY);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "a link outside Git to a key inside a checkout",
    code: KeyFileRefusal.InsideGitWorktree,
    setup: async (root) => {
      await mkdir(path.join(root, "repo", ".git"), { recursive: true });
      const file = path.join(root, "repo", "k.key");
      await keyAt(file, KEY);
      const link = path.join(root, "outside", "k.key");
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(file, link);
      return { env: { [EVALS_KEY_FILE_ENV]: link }, file };
    },
  },
  {
    name: "a link inside a checkout to a private key outside",
    code: KeyFileRefusal.InsideGitWorktree,
    setup: async (root) => {
      const file = path.join(root, "safe", "k.key");
      await keyAt(file, KEY);
      await mkdir(path.join(root, "repo", ".git"), { recursive: true });
      const link = path.join(root, "repo", "k.key");
      await symlink(file, link);
      return { env: { [EVALS_KEY_FILE_ENV]: link }, file };
    },
  },
  {
    name: "a v2 lookalike",
    code: KeyFileRefusal.BadShape,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await keyAt(file, `genex_sk_v2_${BODY}`);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "a key with text after it",
    code: KeyFileRefusal.BadShape,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await keyAt(file, `${KEY}\nGENEX_TOKEN=other\n`);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "an empty file",
    code: KeyFileRefusal.BadShape,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await keyAt(file, "");
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "a file too large to be a key",
    code: KeyFileRefusal.TooLarge,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await keyAt(file, `${KEY}${"a".repeat(KEY_FILE_MAX_BYTES)}`);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
  {
    name: "a folder",
    code: KeyFileRefusal.NotAFile,
    setup: async (root) => {
      const file = path.join(root, "k.key");
      await mkdir(file, { recursive: true });
      await chmod(file, 0o700);
      return { env: { [EVALS_KEY_FILE_ENV]: file }, file };
    },
  },
];

describe("the ingest key file: refused unless private, outside Git and key-shaped", { skip: posixOnly }, () => {
  for (const row of HOSTILE_KEY_FILES) {
    it(`${row.name} → ${row.code}, file untouched, key never in the message`, async () => {
      const root = await tmpDir("eval-key-");
      const { env, file } = await row.setup(root);
      const before = await stat(file);
      const content = before.isFile() ? await readFile(file, "utf8") : null;
      const error = await refusedWith(env);
      assert.equal(error.code, row.code);
      assert.equal(error.message.includes(BODY), false);
      const after = await stat(file);
      assert.equal(after.mode, before.mode);
      assert.equal(after.isFile() ? await readFile(file, "utf8") : null, content);
    });
  }

  it("a missing file, a relative path and no configuration are refused", async () => {
    const root = await tmpDir("eval-key-");
    assert.equal(
      (await refusedWith({ [EVALS_KEY_FILE_ENV]: path.join(root, "absent.key") })).code,
      KeyFileRefusal.Missing,
    );
    assert.equal((await refusedWith({ [EVALS_KEY_FILE_ENV]: "secrets/k.key" })).code, KeyFileRefusal.NotAbsolute);
    assert.equal((await refusedWith({ [EVALS_HOME_ENV]: "relative-home" })).code, KeyFileRefusal.NotAbsolute);
    assert.equal((await refusedWith({})).code, KeyFileRefusal.NotConfigured);
  });

  it("the key file variable wins over the eval home", () => {
    assert.equal(keyFilePath({ [EVALS_KEY_FILE_ENV]: "/a/b.key", [EVALS_HOME_ENV]: "/home" }), "/a/b.key");
    assert.equal(keyFilePath({ [EVALS_HOME_ENV]: "/home" }), path.join("/home", "secrets", "genex-evals.key"));
  });

  it("accepts a private key (0600 or 0400) outside Git, with or without a trailing newline", async () => {
    const minted = "genex_sk_v1_FAKE-aaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    for (const [mode, content] of [
      [0o600, KEY],
      [0o400, `${KEY}\n`],
      [0o600, minted],
    ] as const) {
      const root = await tmpDir("eval-key-");
      const file = path.join(root, "secrets", "genex-evals.key");
      await keyAt(file, content, mode);
      const key = await readIngestKey({ [EVALS_HOME_ENV]: root });
      assert.equal(key.bearer(), `Bearer ${content.trimEnd()}`);
    }
  });

  it("the accepted key prints as [redacted] every way it can be printed", async () => {
    const root = await tmpDir("eval-key-");
    const file = path.join(root, "k.key");
    await keyAt(file, KEY);
    const key = await readIngestKey({ [EVALS_KEY_FILE_ENV]: file });
    for (const printed of [String(key), `${key}`, JSON.stringify({ key }), inspect(key), inspect({ nested: key })])
      assert.equal(printed.includes(BODY), false, printed);
    assert.deepEqual(Object.keys(key).includes("value"), false);
  });
});
