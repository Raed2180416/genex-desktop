import assert from "node:assert/strict";
import { test } from "node:test";
import {
  releaseIntent,
  assertDraftTarget,
  assertUpdateFeedAssets,
  distributionPlatforms,
} from "../../scripts/release-policy.mjs";
import { releaseArtifacts, verifyReleaseArtifacts } from "../../scripts/release-manifest.mjs";
import { uploadRelease } from "../../scripts/upload-release.mjs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp.ts";
import { createHash } from "node:crypto";

const MACOS = ["darwin", "arm64"];
const LINUX = ["linux", "x64"];
const WINDOWS = ["win32", "x64"];

/** One zip and its provenance per platform, plus the inventory: what the publish job downloads. */
async function releaseFixture(directory: string, expected: Record<string, string>, platforms: string[][]) {
  for (const [platform, arch] of platforms) {
    const file = `${platform}.zip`;
    await writeFile(path.join(directory, file), platform);
    const manifest = {
      ...expected,
      platform,
      arch,
      signed: platform !== "linux",
      artifacts: [
        {
          file,
          sha256: createHash("sha256")
            .update(platform ?? "")
            .digest("hex"),
        },
      ],
    };
    await writeFile(path.join(directory, `PROVENANCE-${platform}-${arch}.json`), JSON.stringify(manifest));
  }
  await writeFile(
    path.join(directory, "SBOM.cyclonedx.json"),
    JSON.stringify({ bomFormat: "CycloneDX", components: [] }),
  );
}

const expected = { version: "0.1.0", source: "a".repeat(40), electron: "43.7.6", lockfileSha256: "b".repeat(64) };

test("distribution verifies each platform's source, signing and package bytes before upload", async () => {
  const directory = await tmpDir();
  const platforms = [MACOS, LINUX, WINDOWS];
  await releaseFixture(directory, expected, platforms);
  await verifyReleaseArtifacts(directory, expected, platforms);
  await writeFile(path.join(directory, "win32.zip"), "changed");
  await assert.rejects(verifyReleaseArtifacts(directory, expected, platforms), /hash/);
  await writeFile(path.join(directory, "win32.zip"), "win32");
  const file = path.join(directory, "PROVENANCE-darwin-arm64.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  for (const patch of [{ source: "another source" }, { signed: false }]) {
    await writeFile(file, JSON.stringify({ ...manifest, ...patch }));
    await assert.rejects(verifyReleaseArtifacts(directory, expected, platforms), /provenance|signing/);
  }
  await writeFile(file, JSON.stringify(manifest));
  await writeFile(path.join(directory, "extra.zip"), "unreviewed");
  await assert.rejects(verifyReleaseArtifacts(directory, expected, platforms), /unlisted/);
});

test("a macOS-first draft verifies macOS and Linux and refuses Windows packages it does not list", async () => {
  const directory = await tmpDir();
  const platforms = distributionPlatforms({ macos: true, windows: false });
  await releaseFixture(directory, expected, platforms);
  await verifyReleaseArtifacts(directory, expected, platforms);
  await writeFile(path.join(directory, "win32.zip"), "unsigned");
  await assert.rejects(verifyReleaseArtifacts(directory, expected, platforms), /unlisted/);
});

const candidate = { version: "0.1.0-rc.1", refType: "branch", refName: "dev", publish: false, mainAncestor: false };

/** What the makers name the assets update.electronjs.org serves installed copies from. */
const FEED_ASSETS = ["Genex-darwin-arm64-0.2.0.zip", "Genex-Setup.exe", "RELEASES", "genex-0.2.0-full.nupkg"];

/** A release folder holding the update feed's assets. */
async function writeFeedAssets(directory: string): Promise<void> {
  for (const name of FEED_ASSETS) await writeFile(path.join(directory, name), name);
}

test("an unsigned build-only candidate is allowed from dev without publication", () => {
  assert.deepEqual(releaseIntent(candidate), { tag: "v0.1.0-rc.1", publish: false, prerelease: true });
});

test("publication requires a matching tag from main history, or a manual main candidate", () => {
  const tag = { ...candidate, refType: "tag", refName: "v0.1.0-rc.1", mainAncestor: true };
  assert.equal(releaseIntent(tag).publish, true);
  for (const change of [{ refName: "v0.1.0" }, { mainAncestor: false }])
    assert.throws(() => releaseIntent({ ...tag, ...change }));
  assert.throws(() => releaseIntent({ ...candidate, publish: true }));
  assert.equal(releaseIntent({ ...candidate, refName: "main", publish: true, mainAncestor: true }).publish, true);
});

test("published releases and a different draft source are immutable", () => {
  assertDraftTarget({ isDraft: true, targetCommitish: "abc" }, "abc");
  assert.throws(() => assertDraftTarget({ isDraft: false, targetCommitish: "abc" }, "abc"), /published/);
  assert.throws(() => assertDraftTarget({ isDraft: true, targetCommitish: "def" }, "abc"), /source/);
});

test("a draft distributes signed macOS with Linux, and Windows only once it is signed", () => {
  assert.deepEqual(distributionPlatforms({ macos: true, windows: true }), [MACOS, LINUX, WINDOWS]);
  assert.deepEqual(distributionPlatforms({ macos: true, windows: false }), [MACOS, LINUX]);
  for (const windows of [true, false])
    assert.throws(() => distributionPlatforms({ macos: false, windows }), /signed macOS/);
});

test("a release carries every asset update.electronjs.org serves installed copies from", () => {
  assertUpdateFeedAssets([...FEED_ASSETS, "Genex-0.2.0-arm64.dmg", "SHA256SUMS"]);
  for (const name of FEED_ASSETS)
    assert.throws(() => assertUpdateFeedAssets(FEED_ASSETS.filter((other) => other !== name)), /update feed/, name);
  // The service picks the macOS zip by -darwin- and -arm64 in its name; an Intel zip serves no Apple Silicon copy.
  const intel = FEED_ASSETS.map((name) => name.replace("-arm64", "-x64"));
  assert.throws(() => assertUpdateFeedAssets(intel), /macOS/);
});

test("a macOS-first release needs only the macOS feed asset; Windows' join once Windows ships", () => {
  const [macZip, ...windowsAssets] = FEED_ASSETS;
  assertUpdateFeedAssets([macZip ?? "", "Genex-0.2.0-arm64.dmg"], { windows: false });
  assert.throws(() => assertUpdateFeedAssets(windowsAssets, { windows: false }), /macOS/);
  assert.throws(() => assertUpdateFeedAssets([macZip ?? ""], { windows: true }), /Windows/);
});

test("artifact provenance hashes regular packages and refuses links without modifying files", async () => {
  const dir = await tmpDir();
  await mkdir(path.join(dir, "platform"));
  await writeFile(path.join(dir, "platform", "fixture.zip"), "package");
  await writeFile(path.join(dir, "private.txt"), "outside");
  const rows = await releaseArtifacts(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.file, "platform/fixture.zip");
  assert.match(rows[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  await symlink(path.join(dir, "private.txt"), path.join(dir, "leak.zip"));
  await assert.rejects(releaseArtifacts(dir), /symlink/);
  assert.equal(await readFile(path.join(dir, "private.txt"), "utf8"), "outside");
});

test("draft upload validates artifacts before remote writes and never replaces public assets", async () => {
  const directory = await tmpDir();
  const calls: string[][] = [];
  let releases: unknown[] = [];
  let existing = { isDraft: false, targetCommitish: "source" };
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") return JSON.stringify({ sha: "source" });
    if (args[1] === "list") return JSON.stringify(releases);
    if (args[1] === "view") return JSON.stringify(existing);
    return "";
  };
  const candidate = {
    version: "0.1.0-rc.1",
    repo: "fixture/repo",
    source: "source",
    macos: true,
    windows: true,
    directory,
    run,
  };
  await assert.rejects(uploadRelease(candidate), /No release artifacts/);
  assert.equal(calls.length, 0);
  await writeFile(path.join(directory, "fixture.zip"), "package");
  await assert.rejects(uploadRelease(candidate), /update feed/);
  assert.equal(calls.length, 0, "a release installed copies cannot update from is never drafted");
  await writeFeedAssets(directory);
  await uploadRelease(candidate);
  assert.deepEqual(
    calls.map((args) => (args[0] === "api" ? "api" : args[1])),
    ["api", "list", "create", "upload"],
  );
  assert.ok(calls[2]?.includes("--draft"));
  assert.ok(calls[2]?.includes("--prerelease"));
  assert.ok(calls[2]?.includes("--verify-tag"));
  assert.ok(!calls[3]?.includes("--clobber"));
  calls.length = 0;
  releases = [{ tagName: "v0.1.0-rc.1" }];
  await assert.rejects(uploadRelease(candidate), /published/);
  assert.deepEqual(
    calls.map((args) => (args[0] === "api" ? "api" : args[1])),
    ["api", "list", "view"],
  );
  calls.length = 0;
  existing = { isDraft: true, targetCommitish: "another-source" };
  await assert.rejects(uploadRelease(candidate), /different source/);
  assert.deepEqual(
    calls.map((args) => (args[0] === "api" ? "api" : args[1])),
    ["api", "list", "view"],
  );
  calls.length = 0;
  await symlink(path.join(directory, "fixture.zip"), path.join(directory, "outside.zip"));
  await assert.rejects(uploadRelease(candidate), /regular files/);
  assert.equal(calls.length, 0);
});

test("draft upload refuses unsigned macOS before any remote call and proceeds without Windows signing", async () => {
  const directory = await tmpDir();
  await writeFile(path.join(directory, FEED_ASSETS[0] ?? ""), "package");
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") return JSON.stringify({ sha: "source" });
    return "[]";
  };
  const candidate = { version: "0.1.0-rc.3", repo: "fixture/repo", source: "source", directory, run };
  await assert.rejects(uploadRelease({ ...candidate, macos: false, windows: true }), /signed macOS/);
  assert.equal(calls.length, 0);
  await uploadRelease({ ...candidate, macos: true, windows: false });
  assert.deepEqual(
    calls.map((args) => (args[0] === "api" ? "api" : args[1])),
    ["api", "list", "create", "upload"],
  );
});

test("draft creation refuses a missing or mismatched remote tag before writing", async () => {
  const directory = await tmpDir();
  await writeFeedAssets(directory);
  const calls: string[][] = [];
  const candidate = { version: "0.1.0", repo: "fixture/repo", source: "source", macos: true, windows: true, directory };
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") return JSON.stringify({ sha: "another-source" });
    return "[]";
  };
  await assert.rejects(uploadRelease({ ...candidate, run }), /tag.*source/);
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["api"],
  );
  calls.length = 0;
  const missing = (args: string[]) => {
    calls.push(args);
    if (args[0] === "api") throw new Error("Not Found");
    return "[]";
  };
  await assert.rejects(uploadRelease({ ...candidate, run: missing }), /Not Found/);
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["api"],
  );
});
