/**
 * The newest published release of the update repository, for copies nothing installs in place
 * (Linux's deb, rpm and zip): GitHub's `releases/latest` already leaves out drafts and
 * pre-releases. The check never throws; it hands on only a release page of that repository, so
 * whatever the answer says, the browser opens nothing else.
 */
import { z } from "zod";
import { HOUR_MS, SECOND_MS } from "../shared/duration.ts";

/** How often a Linux copy asks: well inside GitHub's 60 anonymous requests an hour. */
export const RELEASE_CHECK_INTERVAL_MS = 6 * HOUR_MS;
/** How long one check may take before it counts as failed. */
const RELEASE_CHECK_TIMEOUT_MS = 15 * SECOND_MS;
/** A release tag: `v` and a semantic version. */
const RELEASE_TAG = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const LatestRelease = z.object({ tag_name: z.string(), html_url: z.string() });

/** A published release: its version and its page on GitHub. */
export interface PublishedRelease {
  version: string;
  url: string;
}

/** What one check found. */
export const ReleaseCheckKind = {
  Newer: "newer",
  Current: "current",
  Failed: "failed",
} as const;
export type ReleaseCheckKind = (typeof ReleaseCheckKind)[keyof typeof ReleaseCheckKind];

export type ReleaseCheck =
  | { kind: typeof ReleaseCheckKind.Newer; release: PublishedRelease }
  | { kind: typeof ReleaseCheckKind.Current }
  | { kind: typeof ReleaseCheckKind.Failed; reason: string };

/** A version's numeric core and its pre-release identifiers ("0.1.0-rc.3" → [0,1,0], ["rc","3"]). */
function versionParts(version: string): { core: number[]; pre: string[] } {
  const [core = "", ...rest] = version.split("-");
  const pre = rest.join("-");
  return { core: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ? pre.split(".") : [] };
}

/** One pre-release identifier against another: numbers numerically and below words. */
function compareIdentifier(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) - Number(b);
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : Number(a > b);
}

/** Two identifier lists in order, the first difference deciding; a missing one sorts first. */
function compareLists(
  left: readonly string[],
  right: readonly string[],
  compare: (a: string, b: string) => number,
): number {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const [x, y] = [left[i], right[i]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const order = compare(x, y);
    if (order !== 0) return order;
  }
  return 0;
}

/** Semantic-version order: negative when `a` is older, 0 when equal; a pre-release sits below its release. */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (delta !== 0) return delta;
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  return compareLists(left.pre, right.pre, compareIdentifier);
}

/** `raw` as an https release page of `repo` on github.com, or null for anything else. */
export function releasePageUrl(repo: string, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const github = url.protocol === "https:" && url.host === "github.com";
  const anonymous = url.username === "" && url.password === "";
  if (!github || !anonymous) return null;
  return url.pathname.startsWith(`/${repo}/releases/`) ? url.href : null;
}

/** What one check needs: the repository, the running version, and how to reach GitHub. */
export interface ReleaseCheckOptions {
  repo: string;
  current: string;
  /** Electron's `net.fetch` in the app; anything fetch-shaped in tests. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

/** The newest published release of `repo`, against the running version. */
export async function latestRelease(options: ReleaseCheckOptions): Promise<ReleaseCheck> {
  const { repo, current, fetchImpl = fetch, timeoutMs = RELEASE_CHECK_TIMEOUT_MS } = options;
  const failed = (reason: string): ReleaseCheck => ({ kind: ReleaseCheckKind.Failed, reason });
  let body: unknown;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return failed(`GitHub answered ${response.status}`);
    body = await response.json();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  const parsed = LatestRelease.safeParse(body);
  if (!parsed.success) return failed("GitHub's answer names no release");
  const version = RELEASE_TAG.exec(parsed.data.tag_name)?.[1];
  if (!version) return failed(`The latest release's tag is not a version: ${parsed.data.tag_name}`);
  const url = releasePageUrl(repo, parsed.data.html_url);
  if (!url) return failed("The latest release's page is not on the update repository");
  if (compareVersions(version, current) <= 0) return { kind: ReleaseCheckKind.Current };
  return { kind: ReleaseCheckKind.Newer, release: { version, url } };
}
