/** Home's Suggest prompt: a hundred distinct ideas, one at a time, never the one just shown. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickPromptIdea, PROMPT_IDEAS } from "../../src/renderer/prompt-ideas.ts";

test("there are a hundred distinct ideas, each one sentence a person might type", () => {
  assert.equal(PROMPT_IDEAS.length, 100);
  assert.equal(new Set(PROMPT_IDEAS).size, 100);
  for (const idea of PROMPT_IDEAS) {
    assert.ok(idea.length <= 80, idea);
    assert.doesNotMatch(idea, /[\n.!?]$/, idea);
  }
});

test("a pick is never the idea just shown", () => {
  const first = PROMPT_IDEAS[0];
  for (const roll of [0, 0.25, 0.5, 0.999]) {
    const next = pickPromptIdea(first, () => roll);
    assert.notEqual(next, first);
    assert.ok((PROMPT_IDEAS as readonly string[]).includes(next));
  }
  assert.ok((PROMPT_IDEAS as readonly string[]).includes(pickPromptIdea(null)));
});
