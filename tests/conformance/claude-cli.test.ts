import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAuthStatus } from "../../src/substrate/engines/claude-cli.ts";
import { ClaudeLoginController } from "../../src/main/claude-login.ts";

describe("claude CLI auth parsing", () => {
  it("reads JSON loggedIn: true", () => {
    const status = parseAuthStatus(0, JSON.stringify({ loggedIn: true, email: "a@b.c" }), "");
    assert.equal(status.loggedIn, true);
    assert.match(status.detail, /a@b\.c/);
  });

  it("reads JSON logged_in: false", () => {
    const status = parseAuthStatus(1, JSON.stringify({ logged_in: false }), "");
    assert.equal(status.loggedIn, false);
  });

  it("treats 'not logged in' text as signed out", () => {
    const status = parseAuthStatus(1, "", "Not logged in. Run claude auth login.");
    assert.equal(status.loggedIn, false);
  });

  it("treats an expired session as signed out", () => {
    const status = parseAuthStatus(1, "", "OAuth session expired and could not be refreshed");
    assert.equal(status.loggedIn, false);
    assert.match(status.detail, /expired/i);
  });

  it("treats a clean exit as signed in when the text is ambiguous", () => {
    const status = parseAuthStatus(0, "Logged in as you", "");
    assert.equal(status.loggedIn, true);
  });

  it("does not pretend Terminal started when the binary is missing", async () => {
    const result = await new ClaudeLoginController({
      findBinary: async () => null,
      openExternal: async () => {},
      onState: () => {},
      onConnected: async () => {},
    }).start(null);
    assert.equal(result.started, false);
    assert.equal(result.missingCli, true);
  });
});
