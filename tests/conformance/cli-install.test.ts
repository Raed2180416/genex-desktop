import { it } from "node:test";
import assert from "node:assert/strict";
import { createCliInstalls } from "../../src/main/cli-install.ts";

it("a manual update never invokes the installer and refuses active work", async () => {
  let installs = 0;
  let updates = 0;
  let busy = true;
  const jobs = createCliInstalls({
    install: async () => {
      installs++;
      return { ok: true };
    },
    update: async () => {
      updates++;
      return { ok: true };
    },
    busy: () => busy,
    found: async () => true,
    pushUiEvent: () => {},
    log: () => {},
  });
  assert.throws(() => jobs.start("codex", "update"), /active work/);
  assert.equal(updates, 0);
  busy = false;
  jobs.start("codex", "update");
  const done = await jobs.settled("codex");
  assert.equal(done?.phase, "installed");
  assert.equal(updates, 1);
  assert.equal(installs, 0);
});

import { updateCodingCli } from "../../src/substrate/cli-update.ts";
import { fixtureCodingCli } from "../helpers/external-cli.ts";
it("CLI update runs only the selected executable then verifies that installation", async () => {
  const calls: string[] = [];
  const result = await updateCodingCli("codex", "/selected/codex", {
    resolve: async (provider, executable) => {
      calls.push(`resolve ${executable}`);
      return { ...(await fixtureCodingCli(provider)), path: "/selected/codex" };
    },
    run: async (binary, args) => {
      calls.push(`${binary} ${args.join(" ")}`);
      return { code: 0, stdout: "", stderr: "" };
    },
    invalidate: () => {
      calls.push("invalidate");
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    "resolve /selected/codex",
    "/selected/codex update",
    "invalidate",
    "resolve /selected/codex",
  ]);
});
