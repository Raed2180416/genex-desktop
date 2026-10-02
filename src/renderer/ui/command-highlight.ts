/**
 * One shell command line as a terminal-savvy chat colours it: each command name, its arguments,
 * quoted strings, leading `NAME=value` settings and the operators between commands. The general
 * bash grammar leaves a plain `brew install ffmpeg` uncoloured; this reads it as a command.
 */
import { escapeCode } from "./syntax-highlight.ts";

/** The highlight classes a part of the line takes (theme.css colours them). */
const CommandPart = {
  Setting: "attr",
  Command: "built_in",
  Argument: "string",
  Operator: "meta",
} as const;
type CommandPart = (typeof CommandPart)[keyof typeof CommandPart];

/** A word (quoted parts kept whole), an operator, or a run of spaces. */
const TOKEN = /\s+|&&|\|\||[|;&<>]+|(?:"(?:\\.|[^"\\])*"?|'[^']*'?|[^\s|;&<>"'])+/g;
/** An operator after which the next word starts a new command. */
const STARTS_COMMAND = new Set(["&&", "||", "|", ";", "&"]);
/** `NAME=value` in front of a command sets its environment. */
const SETTING = /^[A-Za-z_]\w*=/;

const span = (part: CommandPart, text: string): string => `<span class="hljs-${part}">${escapeCode(text)}</span>`;

/** The command line as escaped HTML with highlight spans. */
export function highlightCommand(line: string): string {
  let expectsCommand = true;
  let html = "";
  for (const [token] of line.matchAll(TOKEN)) {
    if (!token.trim()) html += token;
    else if (/^[|;&<>]/.test(token)) {
      html += span(CommandPart.Operator, token);
      if (STARTS_COMMAND.has(token)) expectsCommand = true;
    } else if (expectsCommand && SETTING.test(token)) html += span(CommandPart.Setting, token);
    else {
      html += span(expectsCommand ? CommandPart.Command : CommandPart.Argument, token);
      expectsCommand = false;
    }
  }
  return html;
}
