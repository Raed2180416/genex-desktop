import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** One resolver for all development/test launches, including Electron's lazy install. */
export function resolveElectron(checkout = process.cwd()) {
  const require = createRequire(path.join(checkout, "package.json"));
  try {
    const executable = /** @type {unknown} */ (require("electron"));
    if (typeof executable !== "string") throw new Error("Electron resolver returned no executable path");
    fs.accessSync(executable, fs.constants.X_OK);
    return executable;
  } catch (error) {
    throw new Error(
      `Pinned Electron is unavailable. Run node node_modules/electron/install.js with network access, then retry. ${error.message}`,
    );
  }
}

/** Disposable fixture profiles only. Never use mock encryption with real account data. */
export function fixtureElectronArgs(args, platform = process.platform) {
  return [...(platform === "darwin" ? ["--use-mock-keychain"] : []), ...args];
}
/** @param {NodeJS.ProcessEnv} source @returns {NodeJS.ProcessEnv} */
export function fixtureElectronEnv(source = process.env) {
  const env = {
    ...source,
    STUDIO_DISABLE_OS_CREDENTIALS: "1",
    STUDIO_ALLOW_LIVE_CREDENTIAL_CHECKS: "0",
    STUDIO_LIVE_CLAUDE_CLI: "0",
    STUDIO_LIVE_OLLAMA: "0",
  };
  for (const key of FIXTURE_SCRUBBED_ENV) delete env[key];
  return env;
}
/**
 * Provider credentials and login homes a fixture run must not inherit. An agent session that
 * drives `studio:dev` carries its own Claude/Codex login in these, and the engines read them.
 */
export const FIXTURE_SCRUBBED_ENV = Object.freeze([
  "ELECTRON_RUN_AS_NODE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_HOME",
  "GENEX_TOKEN",
]);
