/** Keyboard rules the stage's canvases share. */

/** Whether a key press landed in a field that owns its own keys: an input, a text area or editable text. */
export function typingIn(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}
