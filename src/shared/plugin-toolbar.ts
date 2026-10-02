import type { PluginInfo, PluginToolbarItem, PluginToolbarStatus } from "./plugins.ts";

/** One button contributed to the stage strip; `key` is the value of `data-plugin-toolbar`. */
export interface PluginToolbarEntry {
  key: string;
  plugin: PluginInfo;
  item: PluginToolbarItem;
}
const TONES = new Set(["ok", "warn", "err", "info"]);

/** Buttons to render for the current project: enabled, installed plugins only; items that need a project wait for one. */
export function toolbarItems(plugins: readonly PluginInfo[], project: string | null | undefined): PluginToolbarEntry[] {
  const entries: PluginToolbarEntry[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled || plugin.removed || plugin.unlisted) continue;
    for (const item of plugin.manifest.toolbar ?? []) {
      if (item.requiresProject !== false && !project) continue;
      entries.push({ key: `${plugin.manifest.id}:${item.id}`, plugin, item });
    }
  }
  return entries;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const clean = String(value).replace(/\s+/g, " ").trim().slice(0, max);
  return clean || undefined;
};

/** A plugin's own `plugin.event` value addressed to its toolbar: `{kind: "toolbar", item?, …status}`. */
export function isToolbarEvent(value: unknown): value is { kind: "toolbar"; item?: unknown } {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "toolbar";
}

/** Sanitize a status returned by a plugin action or pushed through a `plugin.event` of kind `toolbar`. */
export function toolbarStatusFrom(value: unknown): PluginToolbarStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>,
    status: PluginToolbarStatus = {};
  const badge = text(raw.badge, 16),
    title = text(raw.title, 120);
  if (badge !== undefined) status.badge = badge;
  if (title !== undefined) status.title = title;
  if (raw.disabled !== undefined) status.disabled = Boolean(raw.disabled);
  if (typeof raw.tone === "string" && TONES.has(raw.tone)) status.tone = raw.tone as PluginToolbarStatus["tone"];
  return status;
}
