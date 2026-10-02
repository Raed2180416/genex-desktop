import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChatFileLink, ChatFileLookup, ChatFileRef } from "../../src/shared/chat-files.ts";
import { gameRelativePath, readCommitFile, readFolderFile } from "../../src/main/game-file.ts";
import { markdownHtml } from "../../src/renderer/ui/markdown-html.ts";
import { coreLite } from "../helpers/core-lite.ts";
import { tmpDir } from "../helpers/tmp.ts";

const known = new Map<string, ChatFileLink | null>([
  ["docs/RESEARCH.md", { open: "beside", path: "docs/RESEARCH.md" }],
  ["docs/BRIEF.md", { open: "beside", path: "docs/BRIEF.md" }],
  ["Node.js", null],
]);
const lookup: ChatFileLookup = (name) => known.get(name);

test("file names in replies become file buttons once main knows them; code names and URLs stay text", () => {
  const names: ChatFileRef[] = [];
  const html = markdownHtml(
    "The documents are here: `docs/RESEARCH.md` and [the plan](docs/BRIEF.md). Uses `Node.js`, see [site](https://example.com).",
    { files: { lookup, names } },
  );
  assert.match(
    html,
    /<button type="button" class="prose-file" data-file-path="docs\/RESEARCH.md" data-file-open="beside" data-file-target="docs\/RESEARCH.md" title="Opens beside the chat">/,
  );
  assert.match(
    html,
    /data-file-path="docs\/BRIEF.md" data-file-open="beside"[^>]*title="Opens beside the chat\ndocs\/BRIEF.md"/,
  );
  assert.match(html, /<span>the plan<\/span>/);
  assert.match(html, /<code>Node.js<\/code>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.deepEqual([...new Set(names.map((ref) => ref.name))].sort(), ["Node.js", "docs/BRIEF.md", "docs/RESEARCH.md"]);
  assert.doesNotMatch(markdownHtml("`docs/RESEARCH.md`"), /prose-file/, "without a chat nothing is a file");
});

test("a file button cannot carry markup or break out of its attribute", () => {
  const evil: ChatFileLookup = () => ({ open: "app", path: '~/a"onmouseover="alert(1).md' });
  const html = markdownHtml('[x](docs/a"onmouseover="alert(1).md) `docs/<b>.md`', {
    files: { lookup: evil, names: [] },
  });
  assert.match(html, /prose-file/);
  assert.doesNotMatch(html, /onmouseover="alert/);
  assert.doesNotMatch(html, /<b>/);
});

test("names outside the game are refused, never searched for", () => {
  const game = "/Users/me/AI Games/boxer";
  assert.equal(gameRelativePath("docs/BRIEF.md", game), "docs/BRIEF.md");
  assert.equal(gameRelativePath("./docs/../docs/BRIEF.md:12", game), "docs/BRIEF.md");
  assert.equal(gameRelativePath(`${game}/src/main.js`, game), "src/main.js");
  assert.equal(gameRelativePath(`file://${encodeURI(game)}/NOTES.md`, game), "NOTES.md");
  for (const name of [
    "../other/secret.md",
    "/etc/passwd",
    "~/.ssh/id_rsa",
    ".git/config",
    "/Users/me/AI Games/other/a.md",
    "",
  ])
    assert.equal(gameRelativePath(name, game), null, name);
});

test("the game folder and the build answer; links out of the folder do not", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "game-file-"));
  const game = path.join(root, "game");
  mkdirSync(path.join(game, "docs"), { recursive: true });
  writeFileSync(path.join(root, "secret.md"), "outside");
  writeFileSync(path.join(game, "docs", "BRIEF.md"), "# Plan");
  writeFileSync(path.join(game, "art.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  writeFileSync(path.join(game, "blob.bin"), Buffer.from([1, 0, 2, 3]));
  symlinkSync(path.join(root, "secret.md"), path.join(game, "escape.md"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", game, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    })
      .toString()
      .trim();
  git("init", "-q");
  writeFileSync(path.join(game, "docs", "RESEARCH.md"), "only in the build");
  git("add", "docs/RESEARCH.md");
  git("commit", "-qm", "build");
  const head = git("rev-parse", "HEAD");
  git("rm", "-q", "docs/RESEARCH.md");

  assert.deepEqual(await readFolderFile(game, "docs/BRIEF.md"), {
    path: "docs/BRIEF.md",
    name: "BRIEF.md",
    where: "game",
    kind: "markdown",
    text: "# Plan",
  });
  assert.equal((await readFolderFile(game, "art.png"))?.src?.startsWith("data:image/png;base64,"), true);
  assert.equal((await readFolderFile(game, "blob.bin"))?.kind, "other");
  assert.equal(await readFolderFile(game, "escape.md"), null, "a link out of the folder is not followed");
  assert.equal(await readFolderFile(game, "docs/RESEARCH.md"), null);
  assert.deepEqual(await readCommitFile(game, head, "docs/RESEARCH.md"), {
    path: "docs/RESEARCH.md",
    name: "RESEARCH.md",
    where: "build",
    kind: "markdown",
    text: "only in the build",
  });
  assert.equal(await readCommitFile(game, head, "docs"), null, "a folder is not a file");
  assert.equal(await readCommitFile(game, "HEAD~1; rm -rf /", "docs/BRIEF.md"), null);
});

test("a chat reads only its own game: no folder, a name that leaves it, or a link out of it is refused", async () => {
  const { core, gamesRoot } = await coreLite({ gamesRoot: realpathSync.native(await tmpDir("game-file-reader-")) });
  const game = await core.games.scaffold("reader", { title: "Reader" });
  const threadId = await core.threadForGame("reader");
  mkdirSync(path.join(game.dir, "docs"), { recursive: true });
  writeFileSync(path.join(game.dir, "docs", "BRIEF.md"), "# Plan");
  writeFileSync(path.join(gamesRoot, "outside.md"), "secret");
  symlinkSync(path.join(gamesRoot, "outside.md"), path.join(game.dir, "link.md"));

  assert.equal((await core.readGameFile(threadId, "docs/BRIEF.md")).text, "# Plan");
  assert.equal(
    await core.revealGameFile(threadId, "docs/BRIEF.md"),
    path.join(realpathSync.native(game.dir), "docs", "BRIEF.md"),
  );
  for (const name of ["../outside.md", "/etc/passwd", ".git/config", "~/.ssh/id_rsa"]) {
    await assert.rejects(core.readGameFile(threadId, name), /outside this game/, name);
    await assert.rejects(core.revealGameFile(threadId, name), /isn’t in the game folder/, name);
  }
  await assert.rejects(core.readGameFile(threadId, "link.md"), /Couldn’t find link.md/);
  await assert.rejects(core.revealGameFile(threadId, "link.md"), /isn’t in the game folder/);
  const unbound = await core.createGameThread();
  await assert.rejects(core.readGameFile(unbound, "docs/BRIEF.md"), /no game folder/);
});

test("message images come only from that message's saved attachments, and only images", async () => {
  const { core } = await coreLite();
  await core.games.scaffold("pictures", { title: "Pictures" });
  const threadId = await core.threadForGame("pictures");
  const png = { mimeType: "image/png", data: "iVBORw0KGgo=" };
  await core.store.writeArtifact(threadId, "message_attachments_m1", {
    stills: [png, { mimeType: "text/html", data: "<script>" }, { mimeType: "image/png" }],
  });
  assert.deepEqual(await core.messageImages(threadId, "m1"), [png]);
  assert.deepEqual(await core.messageImages(threadId, "missing"), []);
  for (const id of ["../m1", "m1/..", "", "x".repeat(81)])
    assert.deepEqual(await core.messageImages(threadId, id), [], id);
});
