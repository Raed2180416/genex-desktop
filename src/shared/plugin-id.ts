/**
 * A plugin's id: lowercase, starting with a letter, letters, digits and dashes, at most 48
 * characters. The manifest, the marketplace, the installer and the asset namespaces a plugin
 * writes under all take the same rule from here.
 */
export const PLUGIN_ID = /^[a-z][a-z0-9-]{0,47}$/;

export function isPluginId(value: unknown): value is string {
  return typeof value === "string" && PLUGIN_ID.test(value);
}
