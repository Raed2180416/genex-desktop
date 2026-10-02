/**
 * The leaves that read a fast-changing store themselves, so a plugin change or a toast re-renders
 * only them and never the whole shell. Agent frames are read by the Builds graph's own nodes.
 */
import type { ComponentProps, JSX } from "react";
import { PluginsPanel } from "../panels/PluginsPanel.tsx";
import { PreviewPanel } from "../panels/PreviewPanel.tsx";
import { usePlugins, useToasts } from "../state/hooks.ts";
import { studio } from "../state/studio.ts";
import { ToastStack } from "../ui/Toast.tsx";

/** The stage, reading the plugins itself: a plugin change re-renders only the stage. */
export function StagePreview(props: Omit<ComponentProps<typeof PreviewPanel>, "plugins">): JSX.Element {
  const plugins = usePlugins((s) => s.list);
  return <PreviewPanel {...props} plugins={plugins} />;
}

/** The Plugins room, reading the plugin list itself. */
export function PluginsRoom(props: Omit<ComponentProps<typeof PluginsPanel>, "plugins">): JSX.Element {
  const plugins = usePlugins((s) => s.list);
  return <PluginsPanel {...props} plugins={plugins} />;
}

/** The toast stack, reading the toasts itself: a toast coming or going re-renders only the stack. */
export function Toasts(): JSX.Element | null {
  const toasts = useToasts((s) => s.items);
  return <ToastStack toasts={toasts} onDismiss={studio().toasts.dismiss} />;
}
