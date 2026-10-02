/**
 * Claude Code's own reading of an absolute deny rule, for the shapes
 * `src/substrate/engines/claude-permissions.ts` writes: `Tool(//path/**)`, whose last names may
 * hold a character class, `?` and `*`. CLI 2.1.281 hands the pattern after `//` (with `/**`
 * dropped) to node-ignore, case-blind: `*` and `?` stop at `/`, a class is a plain set (`[!x]`
 * is `!` or `x`), a backslash keeps the next character literal, and a match covers everything
 * inside it. The rules' designs were checked against the CLI's own matcher code.
 */
import { absoluteRulePath } from "../../src/substrate/engines/claude-permissions.ts";

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/-]/g;

/** The rule's content as the CLI parses it: `\(`, `\)` and `\\` unescaped. */
function ruleContent(rule: string, tool: string): string | null {
  if (!rule.startsWith(`${tool}(`) || !rule.endsWith(")")) return null;
  return rule
    .slice(tool.length + 1, -1)
    .replaceAll("\\(", "(")
    .replaceAll("\\)", ")")
    .replaceAll("\\\\", "\\");
}

/** A gitignore-style pattern (no `**` inside) as the case-blind regex node-ignore builds for it. */
function patternRegex(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "\\") {
      i++;
      // node-ignore keeps an escaped `*` literal only mid-pattern: at the end it is a wildcard.
      if (pattern.charAt(i) === "*" && i === pattern.length - 1) source += "[^/]*";
      else source += pattern.charAt(i).replace(REGEX_SPECIAL, "\\$&");
    } else if (c === "[") {
      const end = pattern.indexOf("]", i);
      source += pattern.slice(i, end + 1);
      i = end;
    } else if (c === "?") source += "[^/]";
    else if (c === "*") source += "[^/]*";
    else source += c.replace(REGEX_SPECIAL, "\\$&");
  }
  return new RegExp(`^${source}(?:/|$)`, "i");
}

/** Whether one of these `tool` rules denies `target` (an absolute path on this platform). */
export function ruleDenies(rules: string[], tool: string, target: string): boolean {
  const spelled = absoluteRulePath(target)
    .slice(1)
    .replace(/\/{2,}/g, "/");
  return rules.some((rule) => {
    const content = ruleContent(rule, tool);
    if (!content?.startsWith("//") || !content.endsWith("/**")) return false;
    return patternRegex(content.slice(1, -3).replace(/\/{2,}/g, "/")).test(spelled);
  });
}
