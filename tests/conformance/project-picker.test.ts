/**
 * The native folder pickers behind Create game: Open existing folder… opens in the games root, the
 * location beside it; each picks exactly one folder and offers New Folder, so a game can start in a
 * folder made on the spot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { gameLocationPickerOptions, projectPickerOptions } from "../../src/main/project-picker.ts";

const GAMES_ROOT = "/Users/fixture/AI Games";

test("Open existing folder… offers New Folder, and picks exactly one folder in the games root", () => {
  const options = projectPickerOptions(GAMES_ROOT);
  assert.deepEqual(options.properties, ["openDirectory", "createDirectory"], "one folder, or a new one");
  assert.equal(options.defaultPath, GAMES_ROOT, "opens in the games root");
});

test("Create game's location picker picks one folder beside the games folder, offers New Folder, and says it is only where", () => {
  const options = gameLocationPickerOptions(GAMES_ROOT);
  assert.deepEqual(options.properties, ["openDirectory", "createDirectory"]);
  // Not inside it: every library-style folder there is a game, so a New Folder made there would be one.
  assert.equal(options.defaultPath, path.dirname(GAMES_ROOT));
  assert.notEqual(options.title, projectPickerOptions(GAMES_ROOT).title, "not the Open folder question");
});
