/** A connector being added or edited, and the pure rules that turn it into what the host saves. */
import type { McpConnectorView } from "../../../shared/mcp.ts";
import type { McpConnectorDraft, McpDraft } from "../../../shared/mcp-import.ts";

/** The connector form's state: the connector, the secrets typed this session, and its raw text fields. */
export interface Draft {
  connector: McpConnectorDraft;
  createdAt?: string;
  /** A new connector may still choose its id; a saved one may not — the tools are named after it. */
  isNew: boolean;
  /** `env.NAME` / `header.NAME` → the value typed in this session. An empty string clears one. */
  secrets: Record<string, string>;
  /** Exact argv entries; spaces, empty arguments and quotes are literal. */
  args: string[];
  envText: string;
  headerText: string;
}

/** An empty connector: a global, enabled stdio server with no tools filtered. */
export const blankDraft = (): Draft => ({
  connector: { id: "", name: "", transport: "stdio", enabled: true, scope: "global", toolPolicy: {} },
  isNew: true,
  secrets: {},
  args: [],
  envText: "",
  headerText: "",
});

/** The names typed in a free-text field, split on spaces and commas. */
export const splitNames = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);

/** A saved connector opened for editing; its launch approval and its source stay with the host. */
export const draftFrom = (view: McpConnectorView): Draft => {
  const { createdAt, trustedLaunch: _trust, source: _source, ...rest } = view.connector;
  return {
    connector: rest,
    createdAt,
    isNew: false,
    secrets: {},
    args: [...(rest.args ?? [])],
    envText: (rest.env ?? []).join(" "),
    headerText: (rest.headers ?? []).join(" "),
  };
};

/** A connector read from a pasted configuration, opened for review. */
export const draftFromImport = (imported: McpDraft): Draft => ({
  connector: imported.connector,
  isNew: true,
  secrets: imported.secrets,
  args: [...(imported.connector.args ?? [])],
  envText: (imported.connector.env ?? []).join(" "),
  headerText: (imported.connector.headers ?? []).join(" "),
});

/** Drop the fields the other transport owns: a stdio server has no address, a remote one no command. */
function keepTransportFields(connector: McpConnectorDraft, args: string[]): void {
  if (connector.transport === "stdio") {
    delete connector.authentication;
    if (args.length) connector.args = args;
    else delete connector.args;
    delete connector.url;
    delete connector.headers;
    return;
  }
  delete connector.command;
  delete connector.args;
  delete connector.cwd;
}

/** The connector as the host saves it: its transport's fields only, its names split, and a name. */
export function connectorToSave(draft: Draft): McpConnectorDraft & { createdAt?: string } {
  const connector: McpConnectorDraft & { createdAt?: string } = { ...draft.connector };
  if (draft.createdAt) connector.createdAt = draft.createdAt;
  keepTransportFields(connector, draft.args);
  const env = splitNames(draft.envText);
  if (env.length) connector.env = env;
  else delete connector.env;
  if (connector.transport !== "stdio") {
    const headers = splitNames(draft.headerText);
    if (headers.length) connector.headers = headers;
    else delete connector.headers;
  }
  if (!connector.name.trim()) connector.name = connector.id;
  return connector;
}

type ToolPolicy = NonNullable<McpConnectorDraft["toolPolicy"]>;

/** A tool the server offers, switched on or off for the agents. Deny wins, so deny is what moves. */
export function withToolAllowed(policy: ToolPolicy | undefined, raw: string, allowed: boolean): ToolPolicy {
  const current = policy ?? {};
  const deny = new Set(current.deny ?? []);
  if (allowed) deny.delete(raw);
  else deny.add(raw);
  const next: ToolPolicy = {};
  const approved = (current.autoApprove ?? []).filter((name) => allowed || name !== raw);
  if (approved.length) next.autoApprove = approved;
  if (current.allow?.length) {
    next.allow = allowed ? [...new Set([...current.allow, raw])] : current.allow.filter((name) => name !== raw);
  }
  if (deny.size) next.deny = [...deny];
  return next;
}

/** A user-chosen exact tool grant, independent of the server's description or annotations. */
export function withToolAutoApproved(policy: ToolPolicy | undefined, raw: string, approved: boolean): ToolPolicy {
  const names = new Set(policy?.autoApprove ?? []);
  if (approved) names.add(raw);
  else names.delete(raw);
  return { ...policy, autoApprove: [...names] };
}

/** Whether the agents may call a tool: not denied, and allowed when an allow-list exists. */
export function toolAllowed(policy: ToolPolicy | undefined, name: string): boolean {
  const denied = (policy?.deny ?? []).includes(name);
  const allow = policy?.allow;
  return !denied && (!allow?.length || allow.includes(name));
}
