import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeResources, startRig, type Rig } from "../helpers/studio-rig.ts";
import { StudioCore } from "../../src/main/studio-core.ts";
import { GameWorkspaces } from "../../src/substrate/game-workspace.ts";
import { coverFromBrief, validateGameCover } from "../../src/shared/game-library.ts";
import { gameCoverSvg } from "../../src/shared/game-cover.ts";
import { librarySearch } from "../../src/renderer/game-search.ts";
let rig: Rig;
before(async () => {
  rig = await startRig({ replies: [] });
});
after(async () => {
  await rig?.stop();
});
describe("game-first library", () => {
  it("reserves duplicate names without overwriting folders and creates exactly one conversation", async () => {
    const first = await rig.core.createGame("Snow Temple");
    await writeFile(path.join(first.dir, "keep.txt"), "owner content");
    const next = await rig.core.createGame("Snow Temple");
    assert.notEqual(next.name, first.name);
    assert.equal(await readFile(path.join(first.dir, "keep.txt"), "utf8"), "owner content");
    const ids = await Promise.all(Array.from({ length: 5 }, () => rig.core.threadForGame(first.name)));
    assert.equal(new Set(ids).size, 1);
    assert.equal(await rig.core.createGameThread(first.name), ids[0]);
    assert.equal(
      (await rig.core.store.listThreads()).filter((t) => (t.metadata as { project?: string })?.project === first.name)
        .length,
      1,
    );
  });
  it("rename/pin/cover survive restart; removal keeps library files and re-adding restores history", async () => {
    const game = await rig.core.createGame("Neon Harbor");
    const thread = await rig.core.threadForGame(game.name);
    await rig.core.append([{ type: "messages", messages: [{ role: "user", content: "Preserve my history" }] }], thread);
    const cover = coverFromBrief("Neon Harbor");
    await rig.core.updateGame(game.name, { title: "Harbor at dusk", pinned: true, cover });
    const before = await readFile(path.join(game.dir, "studio.json"), "utf8");
    await rig.core.removeGame(game.name);
    assert.ok(!(await rig.core.games.list()).some((g) => g.name === game.name));
    assert.equal(await readFile(path.join(game.dir, "studio.json"), "utf8"), before);
    const restarted = new GameWorkspaces(rig.core.games);
    const [library, presentation] = await Promise.all([restarted.list(), restarted.presentation(game.name)]);
    assert.ok(!library.some((g) => g.name === game.name));
    assert.equal(presentation.primaryThreadId, thread);
    assert.deepEqual(presentation.cover, cover);
    const restored = await rig.core.adoptProject(game.dir);
    assert.equal(restored.name, game.name);
    assert.equal(restored.title, "Harbor at dusk");
    assert.equal(restored.pinned, true);
    assert.deepEqual(restored.cover, cover);
    assert.equal((await rig.core.games.presentation(game.name)).primaryThreadId, thread);
    assert.ok((await rig.core.store.listEvents(thread)).some((e) => e.data.type === "messages"));
  });
  it("chooses a canonical legacy conversation without deleting the others", async () => {
    const game = await rig.core.createGame("Archive planet");
    const primary = await rig.core.threadForGame(game.name);
    const old = await rig.core.store.createThread({
      title: "Earlier idea",
      metadata: { kind: "game", project: game.name },
    });
    assert.equal(await rig.core.threadForGame(game.name), primary);
    assert.equal((await rig.core.store.getRecord(old)).title, "Earlier idea");
  });
  it("keeps the look a game was born with and never replaces a custom image", async () => {
    const game = await rig.core.createGame("First brief");
    const cover = (await rig.core.games.presentation(game.name)).cover;
    assert.equal(cover?.kind, "recipe");
    assert.deepEqual(game.cover, cover);
    await rig.core.games.ensureCover(game.name);
    assert.deepEqual((await rig.core.games.presentation(game.name)).cover, cover);
    const uploaded = { kind: "image" as const, dataUrl: "data:image/png;base64,aGVsbG8=" };
    await rig.core.games.update(game.name, { cover: uploaded });
    await rig.core.games.ensureCover(game.name);
    assert.deepEqual((await rig.core.games.presentation(game.name)).cover, uploaded);
    assert.throws(() => validateGameCover({ kind: "image", dataUrl: 'data:image/svg+xml,<svg onload="alert(1)"/>' }));
  });
  it("creates new games in a chosen folder while existing games keep their folders, names and chats", async () => {
    const original = rig.core.games.root;
    const old = await rig.core.createGame("Old shelf");
    const thread = await rig.core.threadForGame(old.name);
    const chosen = path.join(path.dirname(rig.userData), "chosen games");
    await mkdir(chosen);
    await rig.core.setGamesRoot(chosen);
    assert.equal(rig.core.layout.gamesRoot, chosen);
    assert.deepEqual(JSON.parse(await readFile(path.join(rig.userData, "games-root.json"), "utf8")), { dir: chosen });
    const fresh = await rig.core.createGame("New shelf");
    assert.equal(path.dirname(fresh.dir), chosen);
    const listed = await new GameWorkspaces(rig.core.games).list();
    assert.equal(listed.find((game) => game.name === old.name)?.dir, old.dir);
    assert.ok(listed.some((game) => game.name === fresh.name));
    assert.equal(await rig.core.threadForGame(old.name), thread);
    // Every folder in the root is listed as a game, so a folder holding anything else is refused.
    const busy = path.join(path.dirname(rig.userData), "busy");
    await mkdir(path.join(busy, "photos"), { recursive: true });
    await assert.rejects(rig.core.setGamesRoot(busy), /empty folder/);
    await assert.rejects(rig.core.setGamesRoot(path.join(fresh.dir, "levels")), /outside your games/);
    assert.equal(rig.core.games.root, chosen);
    // Going back is allowed: the old folder holds only this library's games.
    await rig.core.setGamesRoot(original);
    const back = await rig.core.games.list();
    assert.equal(back.find((game) => game.name === old.name)?.dir, old.dir);
    assert.equal(back.find((game) => game.name === fresh.name)?.dir, fresh.dir);
  });
  it("a restart keeps creating games in the chosen folder", async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "games-root-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const userData = path.join(root, "userData");
    const chosen = path.join(root, "chosen");
    await mkdir(userData);
    await mkdir(chosen);
    await writeFile(path.join(userData, "games-root.json"), JSON.stringify({ dir: chosen }));
    const core = new StudioCore({
      paths: { userData, resources: await makeResources() },
      gamesRoot: path.join(root, "default"),
      engines: [],
    });
    await core.init();
    t.after(() => core.stop());
    assert.equal(core.layout.gamesRoot, chosen);
    assert.equal(path.dirname((await core.createGame("Returns here")).dir), chosen);
  });
  it("search ranks titles and prefixes, handles Cyrillic and prototype-like words, and omits removed games", async () => {
    const a = await rig.core.createGame("Moon racer"),
      b = await rig.core.createGame("Racer constructor"),
      c = await rig.core.createGame("Лунный лес");
    const corpus = librarySearch([a, b, c], [], {});
    assert.equal(corpus.search("moon rac")[0]?.game?.name, a.name);
    assert.equal(corpus.search("constructor")[0]?.game?.name, b.name);
    assert.equal(corpus.search("лун")[0]?.game?.name, c.name);
    assert.deepEqual(corpus.search("zzyyxxmissing"), []);
  });
  it("artwork is deterministic, bounded and never embeds the brief as executable SVG", () => {
    const cover = coverFromBrief("<script>alert(1)</script> ice");
    assert.equal(gameCoverSvg(cover), gameCoverSvg(cover));
    assert.ok(gameCoverSvg(cover).length < 20000);
    assert.doesNotMatch(gameCoverSvg(cover), /<script|onload|href=/);
    assert.notEqual(gameCoverSvg(), gameCoverSvg(cover));
  });
});
