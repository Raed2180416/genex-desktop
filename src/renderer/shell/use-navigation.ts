import { useCallback, useMemo } from "react";
import { useThreads } from "../state/hooks.ts";
import type { Studio } from "../state/studio.ts";
import { returnTarget, Room, roomOf, studioThreadOf } from "../state/threads.ts";
import { withViewTransition } from "../ui/view-transition.ts";
import type { ComposerHandoff } from "./use-composer-handoff.ts";
import type { ShellChrome } from "./use-shell-chrome.ts";

/** Leaving home or going back to it is one animated change; anything else switches at once. */
const fromHome = (app: Studio) => (select: () => void) => {
  if (roomOf(app.threads.getState()) === Room.Home) withViewTransition(select);
  else select();
};

/** Moving between conversations and games: each closes Plugins and the drawer on the way. */
export function useNavigation(app: Studio, chrome: ShellChrome, handoff: ComposerHandoff) {
  const { setPluginsOpen, setDrawerOpen, closeOverlays } = chrome;
  const studioThread = useThreads(studioThreadOf);
  const selectThread = useCallback(
    (threadId: string) => {
      fromHome(app)(() => {
        setPluginsOpen(false);
        app.selectThread(threadId);
      });
      setDrawerOpen(false);
    },
    [app, setPluginsOpen, setDrawerOpen],
  );
  /** Home: no conversation open, and the composer that starts a new game. */
  const goHome = useCallback(() => {
    const atHome = roomOf(app.threads.getState()) === Room.Home;
    const go = () => {
      setPluginsOpen(false);
      app.goHome();
    };
    if (atHome) go();
    else withViewTransition(go);
    setDrawerOpen(false);
  }, [app, setPluginsOpen, setDrawerOpen]);
  const enterStudio = useCallback(() => {
    if (studioThread) selectThread(studioThread.id);
  }, [studioThread, selectThread]);
  const { focusWhenOpen, focusOnly } = handoff;
  const enterProject = useCallback(
    (name: string, focusComposer = false): Promise<void> => {
      setPluginsOpen(false);
      return app.enterProject(name, { open: fromHome(app) }).then((record) => {
        if (!record) return;
        if (focusComposer) focusWhenOpen(record.id);
        setDrawerOpen(false);
      });
    },
    [app, setPluginsOpen, setDrawerOpen, focusWhenOpen],
  );
  /** Back to the game chat last open, else the first game; `focusComposer` puts the cursor in it. */
  const returnToGame = useCallback(
    (focusComposer = false) => {
      const { games } = app.library.getState();
      const target = returnTarget(app.threads.getState(), games);
      if (!target) {
        if (games[0]) void enterProject(games[0].name, focusComposer);
        return;
      }
      if (focusComposer) focusOnly(target);
      selectThread(target);
    },
    [app, selectThread, enterProject, focusOnly],
  );
  const selectGame = useCallback((name: string) => enterProject(name), [enterProject]);
  const removeGame = useCallback(
    async (name: string) => {
      if (await app.removeGame(name)) closeOverlays();
    },
    [app, closeOverlays],
  );
  /** New game is home, the wordmark's room, with the cursor in its composer (already there or not). */
  const newGame = useCallback(() => {
    goHome();
    requestAnimationFrame(() => handoff.homeComposer.current?.focus());
  }, [goHome, handoff.homeComposer]);
  return useMemo(
    () => ({ selectThread, enterStudio, returnToGame, enterProject, selectGame, removeGame, newGame, goHome }),
    [selectThread, enterStudio, returnToGame, enterProject, selectGame, removeGame, newGame, goHome],
  );
}

/** The navigation the shell's hooks and parts share. */
export type Navigation = ReturnType<typeof useNavigation>;
