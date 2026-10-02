/** The native folder pickers behind New game and home's folder chip: where a game goes, and a folder to open instead. */
import path from "node:path";
import type { OpenDialogOptions } from "electron";

/** Open existing's words: the folder chosen is the game. */
const OPEN_MESSAGE = {
  title: "Open project folder",
  buttonLabel: "Open",
  message: "Choose a folder, or create one. Images and notes inside it are visible to the agent.",
} as const satisfies Pick<OpenDialogOptions, "title" | "buttonLabel" | "message">;

/** The location picker's words: the folder chosen is only where the game's own folder is made. */
const LOCATION_MESSAGE = {
  title: "Choose where to create the game",
  buttonLabel: "Choose",
  message: "The game gets a new folder of its own inside the folder you choose.",
} as const satisfies Pick<OpenDialogOptions, "title" | "buttonLabel" | "message">;

/**
 * Open existing: one folder, opening in the games root, with New Folder (`createDirectory`,
 * macOS), so a game can start in a folder made right there.
 */
export function projectPickerOptions(gamesRoot: string): OpenDialogOptions {
  return {
    ...OPEN_MESSAGE,
    defaultPath: gamesRoot,
    properties: ["openDirectory", "createDirectory"],
  };
}

/**
 * A new game's location: one folder, with New Folder (macOS). It opens beside the games folder,
 * not inside it: every library-style folder there is a game, so a New Folder made there is one.
 */
export function gameLocationPickerOptions(gamesRoot: string): OpenDialogOptions {
  return {
    ...LOCATION_MESSAGE,
    defaultPath: path.dirname(gamesRoot),
    properties: ["openDirectory", "createDirectory"],
  };
}
