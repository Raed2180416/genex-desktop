import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipAsk,
  contractorIdentity,
  displayChatTitle,
  firstAsksFromEvents,
  formatTokens,
  relativeTime,
} from "../../src/renderer/chat-labels.ts";
import type { EventEnvelope } from "../../src/renderer/types.ts";

describe("chat labels", () => {
  it("names Codex and distinguishes selected models from provider-reported models", () => {
    assert.deepEqual(contractorIdentity("codex", undefined, "gpt-6-astra"), {
      label: "Codex",
      chip: "gpt-6-astra (selected)",
    });
    assert.deepEqual(contractorIdentity("codex", "gpt-6-astra", "gpt-5.6-sol"), {
      label: "Codex",
      chip: "gpt-6-astra",
    });
    assert.deepEqual(contractorIdentity("codex"), { label: "Codex", chip: "Model not reported" });
    assert.deepEqual(contractorIdentity("codex", undefined, "default"), { label: "Codex", chip: "Default model" });
    assert.deepEqual(contractorIdentity("claude-code", "opus"), { label: "Claude Code", chip: "opus" });
    assert.equal(contractorIdentity("bonsai").label, "Bonsai", "every provider is named from the provider table");
    assert.equal(contractorIdentity("gemini-cli").label, "gemini-cli");
    assert.equal(contractorIdentity("").label, "Contractor");
  });

  it("falls back to the first ask when the stored title is just the folder name", () => {
    assert.equal(
      displayChatTitle({ title: "blame", projectTitle: "blame", firstAsk: "Make a rainy megastructure" }),
      "Make a rainy megastructure",
    );
    assert.equal(
      displayChatTitle({ title: "Rooftop chase", projectTitle: "blame", firstAsk: "Make a rainy megastructure" }),
      "Rooftop chase",
    );
    assert.equal(displayChatTitle({ unbound: true }), "New chat");
    assert.equal(
      displayChatTitle({ unbound: true, firstAsk: "A ship through neon rings" }),
      "A ship through neon rings",
    );
  });

  it("reads the oldest user line per thread, not a later keep-going", () => {
    const events = [
      {
        thread_id: "a",
        data: { type: "messages", messages: [{ role: "user", content: "Build the city" }] },
      },
      {
        thread_id: "a",
        data: { type: "messages", messages: [{ role: "user", content: "Keep going" }] },
      },
      {
        thread_id: "b",
        data: { type: "messages", messages: [{ role: "user", content: "A tiny golf course" }] },
      },
    ] as EventEnvelope[];
    assert.deepEqual(firstAsksFromEvents(events), {
      a: "Build the city",
      b: "A tiny golf course",
    });
  });

  it("clips, formats tokens, and prints a short relative clock", () => {
    assert.equal(clipAsk("one\ntwo", 40), "one");
    assert.equal(formatTokens(1_234), "1.2k");
    assert.equal(relativeTime(new Date(1_000).toISOString(), 1_000), "now");
    assert.equal(relativeTime(new Date(1_000).toISOString(), 1_000 + 4 * 60_000), "4m");
    assert.equal(relativeTime(new Date(1_000).toISOString(), 1_000 + 3 * 3_600_000), "3h");
  });
});
