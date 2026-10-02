import { stripVTControlCharacters } from "node:util";
import { containsSecret, SECRET_FIELD_NAME } from "../shared/redact.ts";

/** The longest word, or control string, the filter holds before it gives up on it. */
const MAX_HELD_CHARS = 16_384;
const ESC = "\x1b";
const BEL = "\x07";
/** After ESC: `]` OSC, `P` DCS, `^` PM, `_` APC — strings the filter discards. */
const STRING_INTRODUCERS = "]P^_";
/** A terminal hyperlink (OSC 8) to an https address. */
const OSC_LINK = /^8;[^;]*;(https:\/\/\S+)$/;
/** The byte that ends a CSI sequence. */
const CSI_FINAL = /[@-~]/;
/** Control characters other than tab and newline, which a word is judged without. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** What the sign-in terminal shows in place of a word it will not display. */
const MESSAGE = {
  omitted: "[output omitted]",
  redacted: "[redacted]",
} as const;

/** Where the filter is in the escape grammar. */
const ParseState = {
  Text: "text",
  Escape: "escape",
  Csi: "csi",
  String: "string",
  StringEscape: "string-escape",
} as const;
type ParseState = (typeof ParseState)[keyof typeof ParseState];

/** Hold unfinished words so a split URL/token cannot leak its first half into the UI.
 * Preserve ANSI color/cursor control; discard OSC/DCS strings (links, titles, clipboard).
 * This is display filtering, never a credential parser or a persisted transcript.
 */
export class LoginTerminalOutput {
  #word = "";
  #overflow = false;
  #secretNext = false;
  #state: ParseState = ParseState.Text;
  #control = "";
  private readonly onUrl: (url: string) => void;
  constructor(onUrl: (url: string) => void) {
    this.onUrl = onUrl;
  }
  write(data: string): string {
    let out = "";
    for (const char of data) out += this.#step(char);
    return out;
  }
  /** One character: what it releases for display (a finished word and its space), often nothing. */
  #step(char: string): string {
    if (this.#state === ParseState.String || this.#state === ParseState.StringEscape) {
      this.#inString(char);
      return "";
    }
    if (this.#state === ParseState.Escape) {
      this.#afterEscape(char);
      return "";
    }
    if (char === ESC) {
      this.#state = ParseState.Escape;
      return "";
    }
    if (this.#state === ParseState.Csi) {
      this.#append(char);
      if (CSI_FINAL.test(char)) this.#state = ParseState.Text;
      return "";
    }
    if (/\s/.test(char)) return this.#finish() + char;
    this.#append(char);
    return "";
  }
  /** Inside a discarded control string: remember it until BEL or ST, and report a link in it. */
  #inString(char: string): void {
    const terminated = char === BEL || (this.#state === ParseState.StringEscape && char === "\\");
    if (terminated) {
      const url = OSC_LINK.exec(this.#control)?.[1];
      if (url) this.onUrl(url);
      this.#control = "";
      this.#state = ParseState.Text;
      return;
    }
    this.#state = char === ESC ? ParseState.StringEscape : ParseState.String;
    if (char !== ESC && this.#control.length < MAX_HELD_CHARS) this.#control += char;
  }
  #afterEscape(char: string): void {
    if (STRING_INTRODUCERS.includes(char)) {
      this.#state = ParseState.String;
      this.#control = "";
      return;
    }
    this.#append(ESC + char);
    this.#state = char === "[" ? ParseState.Csi : ParseState.Text;
  }
  end(): string {
    return this.#finish();
  }
  #append(value: string): void {
    if (!this.#overflow && this.#word.length + value.length <= MAX_HELD_CHARS) this.#word += value;
    else {
      this.#word = "";
      this.#overflow = true;
    }
  }
  #finish(): string {
    if (this.#overflow) {
      this.#overflow = false;
      return MESSAGE.omitted;
    }
    const original = this.#word;
    const word = stripVTControlCharacters(original).replace(CONTROL_CHARS, "");
    this.#word = "";
    if (!word) return original;
    for (const url of word.matchAll(/https:\/\/[^\s"'<>]+/g)) this.onUrl(url[0]);
    const followsSecretField = this.#secretNext;
    this.#secretNext = SECRET_FIELD_NAME.test(word);
    const sensitive = followsSecretField || /https?:\/\//i.test(word) || containsSecret(word);
    return sensitive ? MESSAGE.redacted : original;
  }
}
