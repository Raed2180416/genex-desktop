/**
 * The bundled Genex CLI sends crash reports to Sentry unless its environment says not to. Studio
 * starts that CLI two ways — the asset adapter (`plugins/genex/adapter.ts`) and the Genex
 * plugin's `host-cli` MCP server (`main/core/plugin-tools.ts`) — and both build the child's
 * environment from scratch, so both take these variables from here: reporting off unless the
 * user set GENEX_TELEMETRY themselves, and their DO_NOT_TRACK / GENEX_DISABLE_SENTRY opt-outs
 * passed through.
 */
const TELEMETRY_OPT_OUTS = ["DO_NOT_TRACK", "GENEX_DISABLE_SENTRY"] as const;

export function genexTelemetryEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of TELEMETRY_OPT_OUTS) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.GENEX_TELEMETRY = parent.GENEX_TELEMETRY ?? "0";
  return env;
}
