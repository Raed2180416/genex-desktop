/**
 * The license texts Settings → Licenses shows, read from the fixed files the build writes into
 * the app's resources (scripts/third-party-notices.mjs). The page names no path: it only asks.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LicenseTexts } from "../shared/licenses.ts";

/** A text file's contents, or null when the build did not write it. */
async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Genex's license, the bundled-package list and the project's notices from `resources`. */
export async function readLicenseTexts(resources: string): Promise<LicenseTexts> {
  const [license, bundled, notices] = await Promise.all([
    readIfPresent(path.join(resources, "LICENSE")),
    readIfPresent(path.join(resources, "third-party", "NOTICE.md")),
    readIfPresent(path.join(resources, "third-party", "PROJECT-SOURCES.md")),
  ]);
  return { license, bundled, notices };
}
