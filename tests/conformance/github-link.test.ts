import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubLink } from "../../src/shared/github-link.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("a pasted GitHub link reads as the repository, and the folder, version or commit it names", () => {
  const cases: Array<[string, ReturnType<typeof parseGithubLink>]> = [
    [
      "https://github.com/lumen-labs/pixel-sky",
      { owner: "lumen-labs", name: "pixel-sky", repo: "lumen-labs/pixel-sky" },
    ],
    ["github.com/lumen-labs/pixel-sky/", { owner: "lumen-labs", name: "pixel-sky", repo: "lumen-labs/pixel-sky" }],
    ["http://www.GitHub.com/Acme/Tools.git", { owner: "Acme", name: "Tools", repo: "Acme/Tools" }],
    ["  lumen-labs/pixel-sky  ", { owner: "lumen-labs", name: "pixel-sky", repo: "lumen-labs/pixel-sky" }],
    [
      "https://github.com/acme/tools/tree/main/plugins/sky",
      { owner: "acme", name: "tools", repo: "acme/tools", ref: "main", subdir: "plugins/sky" },
    ],
    ["https://github.com/acme/tools/tree/v2.0.1", { owner: "acme", name: "tools", repo: "acme/tools", ref: "v2.0.1" }],
    [
      "https://github.com/acme/tools/blob/main/plugins/sky/plugin.json",
      { owner: "acme", name: "tools", repo: "acme/tools", ref: "main", subdir: "plugins/sky" },
    ],
    [
      "https://github.com/acme/tools/blob/main/plugin.json",
      { owner: "acme", name: "tools", repo: "acme/tools", ref: "main" },
    ],
    [
      "https://github.com/acme/tools/releases/tag/v1.4.0",
      { owner: "acme", name: "tools", repo: "acme/tools", ref: "v1.4.0" },
    ],
    ["https://github.com/acme/tools/releases/latest", { owner: "acme", name: "tools", repo: "acme/tools" }],
    [`https://github.com/acme/tools/commit/${SHA}`, { owner: "acme", name: "tools", repo: "acme/tools", sha: SHA }],
    [
      `https://github.com/acme/tools/tree/${SHA.toUpperCase()}`,
      { owner: "acme", name: "tools", repo: "acme/tools", sha: SHA },
    ],
    ["https://github.com/acme/tools?tab=readme#install", { owner: "acme", name: "tools", repo: "acme/tools" }],
    ["https://github.com/acme/tools/issues/12", { owner: "acme", name: "tools", repo: "acme/tools" }],
    [
      "https://github.com/acme/tools/tree/main/My%20Plugin",
      { owner: "acme", name: "tools", repo: "acme/tools", ref: "main", subdir: "My Plugin" },
    ],
    // The pinned spec developers already use keeps working.
    [`acme/tools@${SHA}`, { owner: "acme", name: "tools", repo: "acme/tools", sha: SHA }],
    [
      `acme/tools/plugins/sky@${SHA}`,
      { owner: "acme", name: "tools", repo: "acme/tools", subdir: "plugins/sky", sha: SHA },
    ],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseGithubLink(input), expected, input);
});

test("anything that is not a public GitHub repository link reads as nothing", () => {
  const hostile = [
    "",
    "   ",
    "pixel-sky",
    "https://github.com/",
    "https://github.com/acme",
    "https://gitlab.com/acme/tools",
    "https://github.com.evil.example/acme/tools",
    "https://evil.example/github.com/acme/tools",
    "https://user:pass@github.com/acme/tools",
    "https://github.com:8443/acme/tools",
    "ftp://github.com/acme/tools",
    "javascript:alert(1)//github.com/acme/tools",
    "file:///github.com/acme/tools",
    "https://gist.github.com/acme/abc",
    "https://raw.githubusercontent.com/acme/tools/main/plugin.json",
    "https://github.com/../tools",
    "https://github.com/acme/..",
    "https://github.com/acme/tools/tree/main/../../etc",
    "https://github.com/acme/tools/tree/main/plugins/%2e%2e/secrets",
    "https://github.com/acme/tools/tree/main/a%2Fb",
    "https://github.com/acme/tools/tree/main/a%5Cb",
    "https://github.com/acme/tools/tree/main/a%00b",
    "https://github.com/acme/tools/tree/main/%E0%A4%A",
    "https://github.com/acme/tools/tree/..%2F/x",
    "https://github.com/ac me/tools",
    "https://github.com/acme/tools\\..\\x",
    "acme/tools@not-a-sha",
    "acme/tools/../x@" + SHA,
  ];
  for (const input of hostile) assert.equal(parseGithubLink(input), null, input);
});

test("the install window names the version a link settled on, and knows when looking again can help", async () => {
  const { versionWords, canLookUp, keptChoice, takesNewestCode, shortDate } = await import(
    "../../src/renderer/panels/plugins/github-install.ts"
  );
  const now = new Date("2026-09-30T12:00:00Z");
  const found = (kind: string, label: string, date?: string) =>
    ({ sha: SHA, version: { kind, label, ...(date ? { date } : {}) } }) as never;
  const sep12 = shortDate("2026-09-12T10:00:00Z", now);
  assert.deepEqual(versionWords(found("release", "v1.4.0", "2026-09-12T10:00:00Z"), false, now), {
    name: "v1.4.0",
    detail: `latest release, ${sep12}`,
  });
  assert.deepEqual(versionWords(found("release", "v1.3.0", "2026-09-12T10:00:00Z"), true, now), {
    name: "v1.3.0",
    detail: sep12,
  });
  assert.deepEqual(versionWords(found("branch", "main", "2026-09-12T10:00:00Z"), false, now), {
    name: "Newest code on main",
    detail: `0123456, ${sep12}`,
  });
  assert.deepEqual(versionWords(found("commit", "0123456"), false, now), { name: "Commit 0123456", detail: "" });
  assert.ok(shortDate("2025-01-02T00:00:00Z", now).includes("2025"), "another year's date says its year");
  assert.equal(shortDate("not a date", now), "");
  assert.equal(takesNewestCode(found("branch", "main"), false), true);
  assert.equal(takesNewestCode(found("branch", "main"), true), false);

  const problem = (p: string) => ({ lookup: { kind: "problem", problem: p }, link: "acme/tools" }) as never;
  assert.equal(canLookUp("  ", null), false);
  assert.equal(canLookUp("acme/tools", null), true);
  assert.equal(canLookUp("acme/tools", problem("no-plugin")), false, "the same link finds no plugin again");
  assert.equal(canLookUp("acme/tools", problem("rate-limited")), true, "a rate limit passes");
  assert.equal(canLookUp("acme/other", problem("no-plugin")), true, "another link is looked up");

  const choose = {
    kind: "choose",
    repo: "acme/tools",
    version: { kind: "release", label: "v1" },
    plugins: [
      { spec: "acme/tools/a@x", subdir: "a" },
      { spec: "acme/tools/b@x", subdir: "b" },
    ],
  } as never;
  assert.equal(keptChoice(choose, "b"), "acme/tools/b@x");
  assert.equal(keptChoice(choose, "c"), null);
});
