/**
 * Linux copies learn about a newer version from GitHub's latest published release (drafts and
 * pre-releases excluded by the endpoint). The check never throws, orders a pre-release below its
 * release, and hands on only a release page of the update repository; anything else is refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, latestRelease, ReleaseCheckKind, releasePageUrl } from "../../src/main/release-check.ts";

const REPO = "genex-games/genex-desktop";
const PAGE = `https://github.com/${REPO}/releases/tag/v0.2.0`;

/** A fetch that answers `body` with `status`, recording the URLs it was asked for. */
function fetchAnswering(body: unknown, status = 200) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, asked };
}

test("versions order numerically, and a pre-release sits below its release", () => {
  const ordered = ["0.1.0-rc.1", "0.1.0-rc.3", "0.1.0", "0.1.1", "0.2.0", "0.10.0", "1.0.0"];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.ok(compareVersions(ordered[i]!, ordered[i + 1]!) < 0, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.ok(compareVersions(ordered[i + 1]!, ordered[i]!) > 0, `${ordered[i + 1]} > ${ordered[i]}`);
  }
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
});

test("a newer published release is found, with its version and release page", async () => {
  const { fetchImpl, asked } = fetchAnswering({ tag_name: "v0.2.0", html_url: PAGE, draft: false });
  const found = await latestRelease({ repo: REPO, current: "0.1.0", fetchImpl });
  assert.deepEqual(found, { kind: ReleaseCheckKind.Newer, release: { version: "0.2.0", url: PAGE } });
  assert.deepEqual(asked, [`https://api.github.com/repos/${REPO}/releases/latest`]);
});

test("the same or an older release means this copy is current; a release beats its own rc", async () => {
  for (const current of ["0.2.0", "0.3.0"]) {
    const { fetchImpl } = fetchAnswering({ tag_name: "v0.2.0", html_url: PAGE });
    assert.deepEqual(await latestRelease({ repo: REPO, current, fetchImpl }), { kind: ReleaseCheckKind.Current });
  }
  const { fetchImpl } = fetchAnswering({ tag_name: "v0.2.0", html_url: PAGE });
  const fromRc = await latestRelease({ repo: REPO, current: "0.2.0-rc.3", fetchImpl });
  assert.equal(fromRc.kind, ReleaseCheckKind.Newer);
});

test("only a release page of the update repository is ever handed on", () => {
  const hostile = [
    "javascript:alert(1)",
    "http://github.com/genex-games/genex-desktop/releases/tag/v0.2.0",
    "https://evil.example/genex-games/genex-desktop/releases/tag/v0.2.0",
    "https://github.com.evil.example/genex-games/genex-desktop/releases/tag/v0.2.0",
    "https://github.com/someone/genex-desktop/releases/tag/v0.2.0",
    "https://github.com/genex-games/genex-desktop-fork/releases/tag/v0.2.0",
    "https://user:pass@github.com/genex-games/genex-desktop/releases/tag/v0.2.0",
    "https://github.com/genex-games/genex-desktop/../other/releases/tag/v0.2.0",
    "https://github.com/genex-games/genex-desktop/pulls",
    "",
  ];
  for (const url of hostile) assert.equal(releasePageUrl(REPO, url), null, url);
  assert.equal(releasePageUrl(REPO, PAGE), PAGE);
});

test("a hostile release page fails the check rather than reaching the browser", async () => {
  const { fetchImpl } = fetchAnswering({ tag_name: "v9.9.9", html_url: "https://evil.example/download" });
  const found = await latestRelease({ repo: REPO, current: "0.1.0", fetchImpl });
  assert.equal(found.kind, ReleaseCheckKind.Failed);
});

test("an error status, a malformed answer or an unversioned tag fails the check without throwing", async () => {
  const answers: [unknown, number][] = [
    [{ message: "Not Found" }, 404],
    [{ message: "API rate limit exceeded" }, 403],
    ["<html>not json", 200],
    [{ html_url: PAGE }, 200],
    [{ tag_name: "nightly", html_url: PAGE }, 200],
    [{ tag_name: 7, html_url: PAGE }, 200],
  ];
  for (const [body, status] of answers) {
    const { fetchImpl } = fetchAnswering(body, status);
    const found = await latestRelease({ repo: REPO, current: "0.1.0", fetchImpl });
    assert.equal(found.kind, ReleaseCheckKind.Failed, JSON.stringify(body));
  }
});

test("a network failure or a check that outlasts its deadline fails without throwing", async () => {
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(
    (await latestRelease({ repo: REPO, current: "0.1.0", fetchImpl: offline })).kind,
    ReleaseCheckKind.Failed,
  );
  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  const found = await latestRelease({ repo: REPO, current: "0.1.0", fetchImpl: hanging, timeoutMs: 5 });
  assert.equal(found.kind, ReleaseCheckKind.Failed);
});
