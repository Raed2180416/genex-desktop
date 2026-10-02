/**
 * The shell's chrome: the compact drawer, Plugins over the workspace, the sidebar toggle and the
 * chat's width as a CSS variable.
 */
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useLayoutEffect, useState } from "react";
import type { AppDialogs as Dialogs } from "../panels/AppDialogs.tsx";
import { chatWidthOf, sidebarToggled } from "../state/layout.ts";
import type { Studio } from "../state/studio.ts";
import { OPEN_PLUGINS_EVENT } from "../ui/ComposerAddMenu.tsx";

const COMPACT = "(max-width: 900px)";
/** The sidebar toggles' labels. Smoke runners and focus moves find the toggles by them. */
const SIDEBAR_TOGGLE = { Show: "Show sidebar", Hide: "Hide sidebar" } as const;

/** Focus the sidebar toggle with this label, once the toggle it replaced is gone. */
function focusSidebarToggle(label: string): void {
  requestAnimationFrame(() => (document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null)?.focus());
}

/** Whether the window is narrow (the sidebar is a drawer), and whether that drawer is open. */
function useCompactWindow() {
  const [compactWindow, setCompactWindow] = useState(() => window.matchMedia(COMPACT).matches);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(COMPACT);
    const change = () => {
      setCompactWindow(media.matches);
      setDrawerOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return { compactWindow, drawerOpen, setDrawerOpen };
}

/**
 * The chat's width as the shell's `--chat-width`, set from the layout store before paint. A drag
 * moves it on every pointer move; writing the variable directly keeps that from re-rendering
 * the whole shell.
 */
export function useChatWidthVariable(shell: RefObject<HTMLDivElement | null>, app: Studio): void {
  useLayoutEffect(() => {
    const apply = (width: number): void => shell.current?.style.setProperty("--chat-width", `${width}px`);
    apply(chatWidthOf(app.layout.getState()));
    return app.layout.subscribe((state) => apply(chatWidthOf(state)));
  }, [app, shell]);
}

/** Plugins opens over the workspace, from the sidebar or from a window event naming a plugin. */
function usePluginsRoom(dialogs: Dialogs, setDrawerOpen: (open: boolean) => void) {
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [setupPlugin, setSetupPlugin] = useState<string | undefined>();
  useEffect(() => {
    const open = (event: Event) => {
      setSetupPlugin((event as CustomEvent<{ plugin?: string }>).detail?.plugin);
      dialogs.dispatch({ type: "close-settings" });
      setPluginsOpen(true);
      setDrawerOpen(false);
    };
    window.addEventListener(OPEN_PLUGINS_EVENT, open);
    return () => window.removeEventListener(OPEN_PLUGINS_EVENT, open);
  }, [dialogs.dispatch, setDrawerOpen]);
  const openPlugins = useCallback(() => {
    setSetupPlugin(undefined);
    setPluginsOpen(true);
    setDrawerOpen(false);
  }, [setDrawerOpen]);
  return { pluginsOpen, setPluginsOpen, setupPlugin, openPlugins };
}

/**
 * The shell's chrome: the compact drawer, Plugins over the workspace, and the sidebar toggle,
 * which puts focus on the toggle that replaces the one pressed.
 */
export function useShellChrome(app: Studio, dialogs: Dialogs, sidebarOpen: boolean) {
  const { compactWindow, drawerOpen, setDrawerOpen } = useCompactWindow();
  const plugins = usePluginsRoom(dialogs, setDrawerOpen);
  const { setPluginsOpen } = plugins;
  const sidebarVisible = compactWindow ? drawerOpen : sidebarOpen;
  const closeOverlays = useCallback(() => {
    setPluginsOpen(false);
    setDrawerOpen(false);
  }, [setPluginsOpen, setDrawerOpen]);
  const toggleSidebar = useCallback(() => {
    if (compactWindow) setDrawerOpen((open) => !open);
    else app.layout.setState((s) => sidebarToggled(s), true);
    focusSidebarToggle(sidebarVisible ? SIDEBAR_TOGGLE.Show : SIDEBAR_TOGGLE.Hide);
  }, [app, compactWindow, sidebarVisible, setDrawerOpen]);
  /** Escape in a compact window: close the drawer; false when it was not open. */
  const closeDrawer = useCallback((): boolean => {
    if (!compactWindow || !drawerOpen) return false;
    setDrawerOpen(false);
    focusSidebarToggle(SIDEBAR_TOGGLE.Show);
    return true;
  }, [compactWindow, drawerOpen, setDrawerOpen]);
  const { pluginsOpen, setupPlugin, openPlugins } = plugins;
  return useMemo(
    () => ({
      pluginsOpen,
      setPluginsOpen,
      setupPlugin,
      openPlugins,
      compactWindow,
      setDrawerOpen,
      sidebarVisible,
      /** The compact drawer is open over the workspace. */
      drawerCovers: compactWindow && drawerOpen,
      /** The chat and Plugins headers show their own sidebar toggle. */
      sidebarHidden: !sidebarVisible || compactWindow,
      closeOverlays,
      toggleSidebar,
      closeDrawer,
    }),
    [
      pluginsOpen,
      setPluginsOpen,
      setupPlugin,
      openPlugins,
      compactWindow,
      setDrawerOpen,
      sidebarVisible,
      drawerOpen,
      closeOverlays,
      toggleSidebar,
      closeDrawer,
    ],
  );
}

/** The chrome the shell's hooks and parts share. */
export type ShellChrome = ReturnType<typeof useShellChrome>;
