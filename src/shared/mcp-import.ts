/**
 * Reading someone else's MCP configuration — pure, renderer-safe, node-free.
 *
 * People already have connectors configured for Claude Code (`.mcp.json` style `mcpServers`
 * JSON) or Codex (`[mcp_servers.<name>]` TOML). Retyping them is where secrets get pasted into
 * the wrong box, so the Connectors card takes a snippet and offers drafts.
 *
 * Two rules the whole file obeys:
 *  - an inline secret **value** never survives into a `McpConnector`; it goes into the separate
 *    `secrets` map the save path stores encrypted, and the connector keeps the NAME only;
 *  - malformed input produces warnings, never an exception. A parser that throws in a paste box
 *    is a parser that eats the paste.
 */
import { MCP_ENV_NAME, MCP_HEADER_NAME, MCP_ID, type McpConnector, type McpTransport } from "./mcp.ts";
import { errorMessage } from "./errors.ts";

/** A connector the user has not saved yet: no `createdAt`, no trust digest, no owner. */
export type McpConnectorDraft = Omit<McpConnector, "createdAt" | "trustedLaunch" | "source">;
/**
 * Secret keys are `env.<NAME>` / `header.<NAME>`, exactly as `mcpSave` expects them. `needsValue`
 * lists the keys whose snippet value was a `${VAR}` placeholder: the name is kept, the value is
 * the user's to paste.
 */
export interface McpDraft {
  connector: McpConnectorDraft;
  secrets: Record<string, string>;
  needsValue?: string[];
}
export interface McpImport {
  drafts: McpDraft[];
  warnings: string[];
}

const MAX_SNIPPET = 256 * 1024;

/** Best-effort id from a server name: lowercase, `_`/space/dot → `-`, trimmed to the id class. */
function draftId(name: string): string | null {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 32);
  return MCP_ID.test(id) ? id : null;
}

function transportOf(entry: { command?: unknown; url?: unknown; type?: unknown }): McpTransport | null {
  const declared = typeof entry.type === "string" ? entry.type.toLowerCase() : undefined;
  if (declared === "sse") return "sse";
  if (declared === "http" || declared === "streamable-http" || declared === "streamablehttp") return "http";
  if (declared === "stdio") return "stdio";
  if (typeof entry.command === "string" && entry.command.trim()) return "stdio";
  if (typeof entry.url === "string" && entry.url.trim()) return "http";
  return null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * A reference to a variable of the source tool's own environment rather than a value: `${VAR}`
 * anywhere (`Bearer ${TOKEN}`), or a whole value that is `$VAR`. A lone `$` inside a real value
 * (`pa$$word`) is a value.
 */
const PLACEHOLDER = /\$\{[^}]*\}|^\$[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Split `{NAME: value}` into declared names and secret values. A name Studio cannot pass to a
 * child (or to a server) is dropped with a warning rather than silently mangled, and a placeholder
 * is kept as a name that still needs its value — storing `${GITHUB_TOKEN}` as the token would
 * import cleanly and then fail every sign-in.
 */
function splitSecrets(
  source: unknown,
  kind: "env" | "header",
  server: string,
  warnings: string[],
): { names: string[]; secrets: Record<string, string>; needsValue: string[] } {
  const names: string[] = [];
  const secrets: Record<string, string> = {};
  const needsValue: string[] = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) return { names, secrets, needsValue };
  const shape = kind === "env" ? MCP_ENV_NAME : MCP_HEADER_NAME;
  for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
    if (!shape.test(name)) {
      warnings.push(
        `${server}: skipped ${kind} name "${name}" — not a valid ${kind === "env" ? "environment variable" : "header"} name`,
      );
      continue;
    }
    names.push(name);
    if (typeof value !== "string" || !value) continue;
    const field = `${kind}.${name}`;
    const placeholder = PLACEHOLDER.exec(value);
    if (placeholder) {
      needsValue.push(field);
      warnings.push(
        `${server}: ${name} refers to ${placeholder[0]}, a variable Studio does not read. Paste the real value into the connector before connecting.`,
      );
      continue;
    }
    secrets[field] = value;
  }
  return { names, secrets, needsValue };
}

/** The server fields a draft reads; any other field is reported as not imported. */
const SUPPORTED_KEYS: ReadonlySet<string> = new Set([
  "command",
  "args",
  "cwd",
  "url",
  "type",
  "env",
  "headers",
  "http_headers",
  "bearer_token_env_var",
  "enabled",
  "disabled",
  "enabled_tools",
  "disabled_tools",
]);

/** Fills in how the connector starts: a stdio command, or a url. False (with a warning) when it cannot. */
function readLaunch(
  connector: McpConnectorDraft,
  entry: Record<string, unknown>,
  name: string,
  warnings: string[],
): boolean {
  if (connector.transport !== "stdio") {
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) {
      warnings.push(`Skipped "${name}": an ${connector.transport} server needs a url.`);
      return false;
    }
    connector.url = url;
    return true;
  }
  const command = typeof entry.command === "string" ? entry.command.trim() : "";
  if (!command) {
    warnings.push(`Skipped "${name}": a stdio server needs a command.`);
    return false;
  }
  connector.command = command;
  const argsAreStrings =
    entry.args === undefined || (Array.isArray(entry.args) && entry.args.every((a) => typeof a === "string"));
  if (!argsAreStrings) {
    warnings.push(`Skipped "${name}": args must be an array of strings; no arguments were silently dropped.`);
    return false;
  }
  connector.args = stringList(entry.args);
  if (typeof entry.cwd === "string" && entry.cwd) connector.cwd = entry.cwd;
  return true;
}

/** The header names to declare: the snippet's own, plus Authorization for a Codex bearer variable. */
function headerNamesOf(names: string[], entry: Record<string, unknown>, name: string, warnings: string[]): string[] {
  const headerNames = [...names];
  const bearer = entry.bearer_token_env_var;
  if (typeof bearer !== "string" || !bearer) return headerNames;
  if (!headerNames.includes("Authorization")) headerNames.push("Authorization");
  warnings.push(
    `${name}: Codex reads the bearer token from the environment variable ${bearer}. Studio stores it itself — paste the token into the Authorization field as "Bearer <token>".`,
  );
  return headerNames;
}

function draftFrom(name: string, entry: Record<string, unknown>, warnings: string[]): McpDraft | null {
  const id = draftId(name);
  if (!id) {
    warnings.push(`Skipped "${name}": Studio connector ids are lowercase letters, digits and dashes.`);
    return null;
  }
  const transport = transportOf(entry);
  if (!transport) {
    warnings.push(`Skipped "${name}": it names neither a command nor a url.`);
    return null;
  }
  const env = splitSecrets(entry.env, "env", name, warnings);
  const headers = splitSecrets(entry.headers ?? entry.http_headers, "header", name, warnings);
  const secrets = { ...env.secrets, ...headers.secrets };
  const needsValue = [...env.needsValue, ...headers.needsValue];
  const connector: McpConnectorDraft = {
    id,
    name,
    transport,
    enabled: entry.enabled !== false && entry.disabled !== true,
    scope: "global",
    toolPolicy: {},
  };
  for (const key of Object.keys(entry))
    if (!SUPPORTED_KEYS.has(key)) warnings.push(`${name}: ${key} is not imported. Review the connector before saving.`);
  if (Array.isArray(entry.enabled_tools)) connector.toolPolicy.allow = stringList(entry.enabled_tools);
  if (Array.isArray(entry.disabled_tools)) connector.toolPolicy.deny = stringList(entry.disabled_tools);
  if (!readLaunch(connector, entry, name, warnings)) return null;
  if (env.names.length) connector.env = env.names;
  const headerNames = headerNamesOf(headers.names, entry, name, warnings);
  if (headerNames.length) connector.headers = headerNames;
  if (Object.keys(secrets).length)
    warnings.push(
      `${name}: ${Object.keys(secrets).length} value(s) came with the snippet and will be stored encrypted. The source configuration is unchanged.`,
    );
  return { connector, secrets, ...(needsValue.length ? { needsValue } : {}) };
}

function fromJson(text: string, warnings: string[]): McpDraft[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push("That JSON is not an object with servers in it.");
    return [];
  }
  const record = parsed as Record<string, unknown>;
  const servers = record.mcpServers ?? record.mcp_servers ?? record.servers ?? record;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    warnings.push('No "mcpServers" section in that JSON.');
    return [];
  }
  const drafts: McpDraft[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`Skipped "${name}": expected an object.`);
      continue;
    }
    const draft = draftFrom(name, entry as Record<string, unknown>, warnings);
    if (draft) drafts.push(draft);
  }
  if (!drafts.length && !warnings.length) warnings.push("No servers found in that snippet.");
  return drafts;
}

/** Where a scan through TOML text stands: inside a string (and which quote), or after a backslash. */
interface QuoteState {
  quote: string;
  escaped: boolean;
}

/** Moves the scan past one character. True when that character is outside every string. */
function outsideString(state: QuoteState, char: string): boolean {
  if (state.escaped) {
    state.escaped = false;
    return false;
  }
  if (state.quote === '"' && char === "\\") {
    state.escaped = true;
    return false;
  }
  if (state.quote) {
    if (char === state.quote) state.quote = "";
    return false;
  }
  if (char === '"' || char === "'") {
    state.quote = char;
    return false;
  }
  return true;
}

/** Split only outside strings. Unclosed strings are errors, never guessed argv boundaries. */
function splitQuoted(text: string, separator: string): string[] {
  const result: string[] = [];
  const state: QuoteState = { quote: "", escaped: false };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (outsideString(state, char) && char === separator) {
      result.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (state.quote) throw new Error("Unclosed TOML string");
  result.push(text.slice(start));
  return result;
}

function stripComment(line: string): string {
  return splitQuoted(line, "#")[0] ?? "";
}

/** A TOML key or value without the quotes around it. */
const unquote = (text: string): string => text.replace(/^(["'])([\s\S]*)\1$/, "$2");

/** The inside of a `[...]` array: quoted strings only. */
function tomlArray(inner: string): string[] {
  const items: string[] = [];
  for (const piece of splitQuoted(inner, ",")) {
    if (!piece.trim()) continue;
    const value = tomlValue(piece);
    if (typeof value !== "string") throw new Error("Connector TOML arrays must contain quoted strings");
    items.push(value);
  }
  return items;
}

/** Deliberately bounded TOML subset. Unsupported syntax fails visibly. */
function tomlValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) return undefined;
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) return undefined;
    const inner = text.slice(1, -1).trim();
    return inner ? tomlArray(inner) : [];
  }
  if (text.startsWith("{")) return undefined;
  const quoted = /^(["'])([\s\S]*)\1$/.exec(text);
  if (quoted) return quoted[1] === '"' ? JSON.parse(text) : quoted[2];
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  throw new Error("Unsupported TOML value. Use quoted strings, booleans or arrays of strings.");
}

type TomlServer = Record<string, unknown>;

/** Which server (and which of its sub-tables) the keys after a `[section]` line belong to. */
interface TomlTarget {
  server: TomlServer | null;
  sub: "env" | "headers" | null;
}

const NO_TARGET: TomlTarget = { server: null, sub: null };

function tomlSection(header: string, servers: Map<string, TomlServer>, warnings: string[]): TomlTarget {
  const parts = splitQuoted(header, ".").map((p) => unquote(p.trim()));
  const [root, name, table] = parts;
  if ((root !== "mcp_servers" && root !== "mcpServers") || !name) return NO_TARGET;
  const server = servers.get(name) ?? {};
  servers.set(name, server);
  if (table === "env" || table === "headers") {
    if (!server[table]) server[table] = {};
    return { server, sub: table };
  }
  if (!table) return { server, sub: null };
  warnings.push(`${name}: table ${parts.slice(2).join(".")} is not imported.`);
  return NO_TARGET;
}

/** An inline `{ A = "b", C = "d" }` table: its string values by unquoted key. */
function inlineTable(inner: string): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  for (const piece of splitQuoted(inner, ",")) {
    const entry = /^\s*([A-Za-z0-9_."'-]+)\s*=\s*(.+?)\s*$/.exec(piece);
    if (!entry) continue;
    const value = tomlValue(entry[2]);
    if (typeof value === "string") table[unquote(entry[1])] = value;
  }
  return table;
}

function readTomlPair({ server, sub }: TomlTarget, key: string, raw: string): void {
  if (!server) return;
  if (sub) {
    const value = tomlValue(raw);
    if (typeof value === "string") (server[sub] as Record<string, unknown>)[key] = value;
    return;
  }
  const inline = /^\{([\s\S]*)\}$/.exec(raw.trim());
  if (inline && (key === "env" || key === "headers")) {
    server[key] = inlineTable(inline[1]);
    return;
  }
  const value = tomlValue(raw);
  if (value !== undefined) server[key] = value;
}

/** A `key = [` line whose array goes on over the next lines, joined into one; and its last line. */
function joinArrayLines(lines: string[], first: number, start: string): { text: string; last: number } {
  let text = start;
  let last = first;
  while (++last < lines.length) {
    text += ` ${stripComment(lines[last] ?? "").trim()}`;
    if (text.endsWith("]")) break;
  }
  if (!text.endsWith("]")) throw new Error("Unclosed TOML array");
  return { text, last };
}

/**
 * The `[mcp_servers.<name>]` subset Codex writes: `command`, `args`, `url`,
 * `bearer_token_env_var`, and either an inline `env = { A = "b" }` or an `[mcp_servers.x.env]`
 * table. Anything else in the file is ignored rather than guessed at.
 */
function fromToml(text: string, warnings: string[]): McpDraft[] {
  const drafts: McpDraft[] = [];
  for (const [name, entry] of tomlServers(text, warnings)) {
    const draft = draftFrom(name, entry, warnings);
    if (draft) drafts.push(draft);
  }
  if (!drafts.length && !warnings.length) warnings.push("No [mcp_servers.<name>] sections found in that snippet.");
  return drafts;
}

/** The servers a Codex TOML snippet declares, by name, with the keys this reader understands. */
function tomlServers(text: string, warnings: string[]): Map<string, TomlServer> {
  const servers = new Map<string, TomlServer>();
  let target = NO_TARGET;
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const trimmed = stripComment(lines[lineIndex] ?? "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(trimmed);
    if (header) {
      target = tomlSection(header[1], servers, warnings);
      continue;
    }
    if (!target.server) continue;
    let line = trimmed;
    if (/=\s*\[/.test(trimmed) && !trimmed.endsWith("]")) {
      const joined = joinArrayLines(lines, lineIndex, trimmed);
      line = joined.text;
      lineIndex = joined.last;
    }
    const pair = /^([A-Za-z0-9_."'-]+)\s*=\s*(.+)$/.exec(line);
    if (pair) readTomlPair(target, unquote(pair[1]), pair[2]);
  }
  return servers;
}

/**
 * Parse a pasted Claude-style JSON or Codex-style TOML snippet into connector drafts.
 * Never throws: everything it cannot read comes back as a warning.
 */
export function parseMcpSnippet(text: unknown): McpImport {
  const warnings: string[] = [];
  if (typeof text !== "string" || !text.trim())
    return { drafts: [], warnings: ["Paste a configuration snippet first."] };
  if (text.length > MAX_SNIPPET) return { drafts: [], warnings: ["That snippet is too large to read."] };
  try {
    // JSON first: `fromJson` returns null only when the text is not JSON at all, which is the
    // one case where reading it as Codex TOML is the right guess.
    const json = fromJson(text.trim(), warnings);
    if (json) return { drafts: json, warnings };
    return { drafts: fromToml(text, warnings), warnings };
  } catch (error) {
    return { drafts: [], warnings: [`Studio could not read that snippet: ${errorMessage(error)}`] };
  }
}
