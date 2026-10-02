import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureElectronEnv } from "../../scripts/electron-runtime.mjs";

// Named here, not read from the module's list, so dropping one from the scrub fails this test.
const CREDENTIALS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_HOME",
  "GENEX_TOKEN",
];

test("fixture env drops every provider credential and login home an agent session could pass in", () => {
  const source: Record<string, string> = {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/fixture",
    TMPDIR: "/tmp/fixture/",
    LANG: "en_US.UTF-8",
    STUDIO_VISIBILITY_REPORT: "/tmp/report.json",
    ELECTRON_RUN_AS_NODE: "1",
    ...Object.fromEntries(CREDENTIALS.map((key) => [key, `synthetic-${key}`])),
  };
  const env = fixtureElectronEnv(source);
  for (const key of [...CREDENTIALS, "ELECTRON_RUN_AS_NODE"]) assert.equal(key in env, false, `${key} survived`);
  assert.equal(
    Object.values(env).some((value) => String(value).startsWith("synthetic-")),
    false,
  );
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "STUDIO_VISIBILITY_REPORT"])
    assert.equal(env[key], source[key], key);
  assert.equal(source.CLAUDE_CODE_OAUTH_TOKEN, "synthetic-CLAUDE_CODE_OAUTH_TOKEN", "caller environment is unchanged");
});
test("fixture env forces Studio credentials and live providers off even when the caller opted in", () => {
  const env = fixtureElectronEnv({
    PATH: "/bin",
    STUDIO_DISABLE_OS_CREDENTIALS: "0",
    STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS: "1",
    STUDIO_LIVE_CLAUDE_CLI: "1",
    STUDIO_LIVE_OLLAMA: "1",
  });
  assert.deepEqual(
    {
      disable: env.STUDIO_DISABLE_OS_CREDENTIALS,
      checks: env.STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS,
      claude: env.STUDIO_LIVE_CLAUDE_CLI,
      ollama: env.STUDIO_LIVE_OLLAMA,
    },
    { disable: "1", checks: "0", claude: "0", ollama: "0" },
  );
});
