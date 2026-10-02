import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightCode, codeLanguage } from "../../src/renderer/ui/syntax-highlight.ts";

test("code grammars highlight explicit languages and preserve unknown/plain logs", () => {
  for (const [path, code] of [
    ["scene.js", 'const light = "warm";'],
    ["scene.ts", "const count: number = 2;"],
    ["style.css", "body { color: red; }"],
    ["data.json", '{"count":2}'],
    ["build.sh", 'echo "ready"'],
  ]) {
    assert.match(highlightCode(code!, codeLanguage(path)), /class="hljs-/);
  }
  assert.equal(
    highlightCode("<script>plain & safe</script>", "unregistered"),
    "&lt;script&gt;plain &amp; safe&lt;/script&gt;",
  );
  assert.equal(highlightCode("tool <ready>"), "tool &lt;ready&gt;");
});

test("large tool output skips highlighting without dropping content", () => {
  const text = "const n = 1;\n".repeat(3000);
  assert.equal(highlightCode(text, "javascript"), text);
});
