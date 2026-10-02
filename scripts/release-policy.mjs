const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The assets update.electronjs.org serves installed macOS copies from, as it recognizes them by
 * name: the Apple Silicon zip (`-darwin-…-arm64….zip`).
 */
const MACOS_FEED_ASSETS = {
  "the macOS arm64 zip": (name) => /-(?:mac|darwin|osx).*\.zip$/i.test(name) && name.includes("-arm64"),
};
/** What it serves installed Windows copies from: Squirrel.Windows' RELEASES, the full package it names and an installer. */
const WINDOWS_FEED_ASSETS = {
  "the Windows RELEASES file": (name) => name === "RELEASES",
  "the Windows full package": (name) => name.endsWith("-full.nupkg"),
  "the Windows installer": (name) => name.endsWith(".exe"),
};

/** Decide release eligibility before any signing credentials or packaging work are available. */
export function releaseIntent({ version, refType, refName, publish, mainAncestor }) {
  if (!VERSION.test(version)) throw new Error("Invalid release version");
  const tag = `v${version}`;
  const tagged = refType === "tag";
  if (tagged && refName !== tag) throw new Error(`Tag ${refName} does not match ${tag}`);
  const uploads = tagged || publish;
  if (uploads && !mainAncestor) throw new Error("Release source must belong to main history");
  if (uploads && !tagged && refName !== "main") throw new Error("Manual publication requires main");
  return { tag, publish: uploads, prerelease: version.includes("-") };
}

/** Existing public assets and a draft belonging to another source are never replaced. */
export function assertDraftTarget(release, source) {
  if (!release.isDraft) throw new Error("Refusing to replace a published release");
  if (release.targetCommitish !== source) throw new Error("Draft release belongs to a different source");
}

/** The packaged platforms a release can carry, as [platform, arch]. */
export const ReleasePlatform = {
  MacOS: ["darwin", "arm64"],
  Linux: ["linux", "x64"],
  Windows: ["win32", "x64"],
};

/**
 * The platforms a draft distributes. macOS ships only signed and notarized; Windows is built and
 * tested every release but ships only once it is signed; Linux packages carry no platform signature.
 */
export function distributionPlatforms({ macos, windows }) {
  if (!macos) throw new Error("Distribution requires a signed macOS artifact");
  const { MacOS, Linux, Windows } = ReleasePlatform;
  return windows ? [MacOS, Linux, Windows] : [MacOS, Linux];
}

/**
 * A release installed copies cannot update from is never drafted: every feed asset of each
 * distributed platform is present. Windows' assets are required once Windows ships (the default).
 */
export function assertUpdateFeedAssets(names, { windows = true } = {}) {
  const required = { ...MACOS_FEED_ASSETS, ...(windows ? WINDOWS_FEED_ASSETS : {}) };
  const missing = Object.entries(required)
    .filter(([, matches]) => !names.some(matches))
    .map(([what]) => what);
  if (missing.length) throw new Error(`The update feed cannot serve this release: missing ${missing.join(", ")}`);
}
