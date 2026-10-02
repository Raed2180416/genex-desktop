/**
 * Where `electron-forge package` puts the app for this machine, for the packaged runners
 * (run-packaged-smoke.mjs, run-terminal-packaged.mjs): out/Genex-<platform>-<arch>, holding
 * Genex.app on macOS, genex.exe on Windows and genex on Linux. STUDIO_PACKAGE_DIR overrides the
 * folder.
 */
import path from "node:path";

const PRODUCT_NAME = "Genex";
const EXECUTABLE_NAME = "genex";

/** The package folder, its launcher, and the folder that holds app.asar. */
export function packagedApp(root, { platform = process.platform, arch = process.arch, env = process.env } = {}) {
  const packageDir = env.STUDIO_PACKAGE_DIR ?? path.join(root, "out", `${PRODUCT_NAME}-${platform}-${arch}`);
  if (platform === "darwin") {
    const appBundle = path.join(packageDir, `${PRODUCT_NAME}.app`);
    return {
      packageDir,
      appBundle,
      bin: path.join(appBundle, "Contents", "MacOS", EXECUTABLE_NAME),
      resourcesDir: path.join(appBundle, "Contents", "Resources"),
    };
  }
  const bin = path.join(packageDir, platform === "win32" ? `${EXECUTABLE_NAME}.exe` : EXECUTABLE_NAME);
  return { packageDir, appBundle: null, bin, resourcesDir: path.join(packageDir, "resources") };
}

/** An archive or folder listing with `/` separators, as the package checks match it on every OS. */
export function posixEntries(entries) {
  return entries.map((entry) => entry.replaceAll("\\", "/"));
}
