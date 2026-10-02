/**
 * The ledger's digests: a text and a file hash the same bytes to the same sha256, `canonicalJson`
 * is key-order blind, and `hashDir` is deterministic, path-sensitive and never follows a link
 * (a link hashes as its target text, so content outside the tree cannot move the digest).
 */
import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, hashDir, hashDirEntries, sha256File, sha256Text } from "../../scripts/evals/ledger/hash.ts";
import { tmpDir } from "../helpers/tmp.ts";

const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

async function tree(files: Record<string, string>): Promise<string> {
  const root = await tmpDir("eval-hash-");
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  }
  return root;
}

describe("sha256Text and sha256File", () => {
  it("hash the known vector and agree on the same bytes", async () => {
    assert.equal(sha256Text("abc"), ABC_SHA256);
    const root = await tree({ "a.txt": "abc" });
    assert.equal(await sha256File(path.join(root, "a.txt")), ABC_SHA256);
  });
});

describe("canonicalJson", () => {
  it("ignores key order at every depth but keeps array order", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [2, 1], c: null } }),
      canonicalJson({ a: { c: null, d: [2, 1] }, b: 1 }),
    );
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });
});

describe("hashDir", () => {
  it("is deterministic across trees with the same paths and bytes", async () => {
    const files = { "b.txt": "two", "a/one.txt": "one", "a/z.txt": "zed" };
    assert.equal(await hashDir(await tree(files)), await hashDir(await tree(files)));
  });

  it("changes when a file is renamed, even with the same bytes", async () => {
    const before = await hashDir(await tree({ "a.txt": "same" }));
    const after = await hashDir(await tree({ "b.txt": "same" }));
    assert.notEqual(before, after);
  });

  it("leaves out excluded paths", async () => {
    const root = await tree({ "keep.txt": "k", "skip/x.txt": "x" });
    const bare = await tree({ "keep.txt": "k" });
    assert.equal(await hashDir(root, { exclude: (relative) => relative.startsWith("skip") }), await hashDir(bare));
  });

  it("hashes a link as its target text and never follows it out of the tree", async () => {
    const outside = await tree({ "secret.txt": "first" });
    const root = await tree({ "a.txt": "a" });
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link"));
    const before = await hashDir(root);
    await writeFile(path.join(outside, "secret.txt"), "second");
    assert.equal(await hashDir(root), before);
    const entries = await hashDirEntries(root);
    assert.deepEqual(
      entries.map(([relative]) => relative),
      ["a.txt", "link"],
    );
  });

  it("does not hang on a link cycle", async () => {
    const root = await tree({ "a.txt": "a" });
    await symlink(root, path.join(root, "loop"));
    assert.match(await hashDir(root), /^[0-9a-f]{64}$/);
  });

  it("refuses a path that is not a directory", async () => {
    const root = await tree({ "a.txt": "a" });
    await assert.rejects(hashDir(path.join(root, "a.txt")), TypeError);
  });
});
