/**
 * What waits on the person, outside the window: a macOS notification while Studio is in the
 * background, and the count on the Dock icon. Electron's `Notification`, the window and the Dock
 * come in as dependencies, so the registrar runs under a recorder in tests.
 */
import { UiEvent } from "../../shared/ui-events.ts";
import type { IpcHandle } from "./registrar.ts";

/** The part of Electron's `Notification` the registrar uses. */
export interface ShownNote {
  on(event: "click" | "close", listener: () => void): unknown;
  show(): void;
}

/** The part of the studio `BrowserWindow` a click brings forward. */
export interface NoteWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export interface NotificationsIpcDeps {
  /** Electron's `Notification.isSupported()` and constructor. */
  notifications: {
    isSupported(): boolean;
    create(options: { title: string; subtitle?: string; body: string }): ShownNote;
  };
  /** The studio window; null while it is closed. */
  window(): NoteWindow | null;
  /** Sets the Dock badge; the empty string clears it. */
  setDockBadge(text: string): void;
  pushUiEvent(event: UiEvent): void;
}

/** The Dock badge's text for a count of waiting work: empty for none, at most "99". */
export function badgeText(count: unknown): string {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  return n ? String(Math.min(n, 99)) : "";
}

export function registerNotificationsIpc(
  handle: IpcHandle,
  { notifications, window: currentWindow, setDockBadge, pushUiEvent }: NotificationsIpcDeps,
): void {
  // Clicking one brings the window forward and opens the row. Shown notes are held until they
  // close, or macOS loses the click handler with the collected object.
  const shownNotes = new Set<ShownNote>();
  handle("studio:notify", async (payload) => {
    if (!notifications.isSupported()) return false;
    const note = notifications.create({
      title: String(payload?.title ?? "").slice(0, 120),
      ...(payload?.subtitle ? { subtitle: String(payload.subtitle).slice(0, 120) } : {}),
      body: String(payload?.body ?? "").slice(0, 240),
    });
    shownNotes.add(note);
    note.on("close", () => shownNotes.delete(note));
    note.on("click", () => {
      shownNotes.delete(note);
      const window = currentWindow();
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
      if (typeof payload?.id === "string" && payload.id)
        pushUiEvent({ type: UiEvent.NotificationOpen, payload: { id: payload.id } });
    });
    note.show();
    return true;
  });
  handle("studio:badge", async (payload) => {
    setDockBadge(badgeText(payload?.count));
    return true;
  });
}
