/**
 * The cards waiting on the user above the composer show one at a time: the one on show stays until
 * it is answered, and a card that cannot be answered never hides one that can.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitingHead } from "../../src/renderer/chat/waiting-cards.ts";

const card = (key: string, blocked = false) => ({ key, blocked });

describe("waiting cards", () => {
  it("shows nothing when nothing waits", () => {
    assert.equal(waitingHead([], null), null);
    assert.equal(waitingHead([], "gone"), null);
  });

  it("shows the first card when none was on show", () => {
    assert.equal(waitingHead([card("a"), card("b")], null), "a");
  });

  it("keeps the card on show while it waits, even when an earlier one arrives", () => {
    assert.equal(waitingHead([card("new"), card("b"), card("c")], "b"), "b");
  });

  it("moves on to the next card once the one on show is answered", () => {
    assert.equal(waitingHead([card("b"), card("c")], "a"), "b");
  });

  it("never lets a card that cannot be answered hide one that can", () => {
    // A question while the chat works cannot be answered; the permission the work waits on can.
    assert.equal(waitingHead([card("question", true), card("permission")], null), "permission");
    assert.equal(waitingHead([card("question", true), card("permission")], "question"), "permission");
  });

  it("keeps a blocked card on show when nothing else can be answered either", () => {
    assert.equal(waitingHead([card("a", true), card("b", true)], "b"), "b");
    assert.equal(waitingHead([card("a", true), card("b", true)], null), "a");
  });
});
