import path from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";

/**
 * Editor-only files the scaffold puts at a package's root (`plugin:new`): type checks for the
 * author, never read by Studio at run time.
 */
const AUTHORING_ONLY = new Set(["jsconfig.json", "tsconfig.json", "plugin-sdk"]);

const MESSAGE = {
  Unpackable: (rel: string) => `Unsupported package file: ${rel} (links and special files cannot be packed)`,
} as const;

/** Dotfiles anywhere, and the scaffold's editor files at the root, stay out of the artifact. */
const isLeftOut = (name: string, relative: string) => name.startsWith(".") || (!relative && AUTHORING_ONLY.has(name));

/**
 * The files of a prebuilt package as an artifact envelope ({relative path: base64}). Dotfiles and
 * dot-folders (`.git`, `.env`, caches) and the scaffold's editor files stay out; a link or special
 * file is refused rather than followed, so nothing outside the folder can end up in the artifact.
 */
export async function packageFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  await packFolder(root, "", files);
  return files;
}

/** Add every packable file under `relative` to `files`, in name order. */
async function packFolder(root: string, relative: string, files: Record<string, string>): Promise<void> {
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    if (isLeftOut(name, relative)) continue;
    await packEntry(root, relative ? `${relative}/${name}` : name, files);
  }
}

/** A folder is walked, a regular file is read, and a link or special file is refused. */
async function packEntry(root: string, rel: string, files: Record<string, string>): Promise<void> {
  const info = await lstat(path.join(root, rel));
  const packable = !info.isSymbolicLink() && (info.isFile() || info.isDirectory());
  if (!packable) throw new Error(MESSAGE.Unpackable(rel));
  if (info.isDirectory()) await packFolder(root, rel, files);
  else files[rel] = (await readFile(path.join(root, rel))).toString("base64");
}
