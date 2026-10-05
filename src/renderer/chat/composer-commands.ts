/**
 * The composer's / commands: a message that is only "/" and a command's name runs the command in
 * the app instead of being sent (`ui/ComposerCommandMenu.tsx` lists them as they are typed).
 */

/** A / command, by the name typed after the slash. Never rename a value: people type them. */
export const ComposerCommand = {
  Compact: "compact",
} as const;
export type ComposerCommand = (typeof ComposerCommand)[keyof typeof ComposerCommand];

/** "/" then letters: the whole message, so "/compact now" or "see /compact" is ordinary text. */
const COMMAND_TEXT = /^\/([a-z-]*)$/i;

/** What was typed after "/" while the message is only a command, caret at its end; else null. */
export function commandQuery(text: string, caret: number | null): string | null {
  if (caret === null || caret !== text.length) return null;
  const match = COMMAND_TEXT.exec(text);
  return match ? (match[1] ?? "").toLowerCase() : null;
}

/** The commands this chat offers whose names start with what was typed. */
export function commandMatches(query: string, offered: readonly ComposerCommand[]): ComposerCommand[] {
  return offered.filter((name) => name.startsWith(query));
}
