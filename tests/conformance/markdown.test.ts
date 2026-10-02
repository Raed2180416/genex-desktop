import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownHtml } from "../../src/renderer/ui/markdown-html.ts";

test("inline and fenced code are escaped once while lists remain semantic", () => {
  const html = markdownHtml(
    '### Assumptions\n- Use `<canvas>` and `a && b`.\n\n```html\n<script type="module">\n</script>\n```',
  );
  assert.match(html, /<h3>Assumptions<\/h3>/);
  assert.match(html, /<ul>\s*<li>/);
  assert.match(html, /<code>&lt;canvas&gt;<\/code>/);
  assert.match(html.replace(/<\/?span[^>]*>/g, ""), /&lt;script type=&quot;module&quot;&gt;/);
  assert.doesNotMatch(html, /&amp;lt;/);
});

test("fenced JavaScript highlights without making its HTML executable", () => {
  const html = markdownHtml('```js\nconst template = "<img src=x onerror=alert(1)>";\n```');
  assert.match(html, /class="hljs-keyword"/);
  assert.match(html, /class="hljs-string"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
test("HTML stays inert and code preserves intentionally written entities", () => {
  const html = markdownHtml("<script>alert(1)</script>\n\n`&lt;canvas&gt;`");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>&amp;lt;canvas&amp;gt;<\/code>/);
});
test("unsafe Markdown destinations cannot create executable links or images", () => {
  const html = markdownHtml(
    "[bad](javascript:alert%281%29) [encoded](javascript&colon;alert%281%29) [numeric](java&#115;cript:alert%281%29) [unclosed](jav&#97script:alert%281%29) [whitespace](java&Tab;script:alert%281%29) ![bad](data:text/html,hello) [good](https://example.com)",
  );
  assert.doesNotMatch(html, /href="(?:java|data)|src="data:/);
  assert.match(html, /href="https:\/\/example.com"/);
});
test("a one-line shell block offers its command to run, and nothing else does", () => {
  const offered = (markdown: string) =>
    [...markdownHtml(markdown).matchAll(/data-command="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(offered("```bash\nbrew install ffmpeg\n```"), ["brew install ffmpeg"]);
  assert.deepEqual(offered("```sh\n  git lfs install  \n```"), ["git lfs install"]);
  assert.deepEqual(offered("```ZSH\nxcode-select --install\n```"), ["xcode-select --install"]);
  const refused = [
    ["another language", "```js\nnpm install\n```"],
    ["no language", "```\nnpm install\n```"],
    ["two commands", "```bash\nnpm install\nnpm test\n```"],
    ["a continued line", "```bash\nbrew install \\\n  ffmpeg\n```"],
    ["a prompt transcript", "```bash\n$ npm test\n```"],
    ["a comment", "```bash\n# npm test\n```"],
    ["an empty block", "```bash\n\n```"],
    ["an inline span", "Run `npm install` first."],
    ["too long", `\`\`\`bash\necho ${"x".repeat(1000)}\n\`\`\``],
  ] as const;
  for (const [name, markdown] of refused) assert.deepEqual(offered(markdown), [], name);
});

test("an offered command stays inert text in its attribute and its block", () => {
  const html = markdownHtml("```bash\necho \"<img src=x onerror=alert(1)>\" '&amp;'\n```");
  assert.match(html, /data-command="echo &quot;&lt;img src=x onerror=alert\(1\)&gt;&quot; &#39;&amp;amp;&#39;"/);
  assert.doesNotMatch(html, /<img/);
});

test("an offered command reads like a shell line: commands, their arguments, strings and operators", () => {
  const html = markdownHtml('```bash\nFORCE=1 nvm use 24 && npm run dev -- --profile "my demo" | tee log.txt\n```');
  const spans = [...html.matchAll(/<span class="hljs-([a-z_]+)">([^<]*)<\/span>/g)].map(([, kind, text]) => [
    kind,
    text,
  ]);
  assert.deepEqual(spans, [
    ["attr", "FORCE=1"],
    ["built_in", "nvm"],
    ["string", "use"],
    ["string", "24"],
    ["meta", "&amp;&amp;"],
    ["built_in", "npm"],
    ["string", "run"],
    ["string", "dev"],
    ["string", "--"],
    ["string", "--profile"],
    ["string", '"my demo"'],
    ["meta", "|"],
    ["built_in", "tee"],
    ["string", "log.txt"],
  ]);
});

test("streaming code fences stay escaped until closed and retain reference links across blocks", () => {
  const partial = markdownHtml("```js\nconst unsafe = '<img>'", { streaming: true });
  assert.ok(partial.includes("&lt;img&gt;"));
  assert.ok(!partial.includes("hljs-"), "an unfinished fence does not highlight the whole growing block");
  const text = "See [guide][g].\n\nAnother paragraph.\n\n[g]: https://example.com";
  assert.equal(markdownHtml(text, { streaming: true }), markdownHtml(text));
});
