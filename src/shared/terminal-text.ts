/**
 * Terminal output as plain text: what a command printed, without the colours, links, titles and
 * cursor moves a terminal would act on. The chat draws a command's output with it, and main reads
 * a finished command's last lines with it, so both show the same text.
 */

/** OSC, DCS, SOS, PM and APC strings (links, titles, clipboard), CSI sequences, and two-byte escapes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are what this removes
const ESCAPE_SEQUENCE = /\u001b(?:[\]PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\[[0-?]*[ -/]*[@-~]|[ -/]*[0-~])/g;
/** Control characters other than tab, left once the escape sequences are gone. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b-\u001f\u007f\u0080-\u009f]/g;

/** What a line shows once carriage returns have overwritten it (a progress bar's last state). */
const lastOverwrite = (line: string): string =>
  line
    .split("\r")
    .filter((part) => part.trim())
    .at(-1) ?? "";

/** Terminal output as the lines a reader sees, trailing spaces trimmed. */
export function plainTerminalLines(raw: string): string[] {
  return raw
    .replace(ESCAPE_SEQUENCE, "")
    .split("\n")
    .map((line) => lastOverwrite(line).replace(CONTROL_CHARACTERS, "").trimEnd());
}
