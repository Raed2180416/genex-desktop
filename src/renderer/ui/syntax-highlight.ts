import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import diff from "highlight.js/lib/languages/diff";
import glsl from "highlight.js/lib/languages/glsl";

/** Longer text is shown plain: highlighting it would hold up the chat. */
const HIGHLIGHT_MAX_CHARS = 32_000;

for (const [name, grammar] of Object.entries({ javascript, typescript, json, css, xml, bash, python, diff, glsl }))
  hljs.registerLanguage(name, grammar);

export const escapeCode = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Explicit grammars only: logs stay plain, and large results never block chat on detection. */
export function highlightCode(text: string, language?: string): string {
  if (text.length > HIGHLIGHT_MAX_CHARS) return escapeCode(text);
  if (!language || !hljs.getLanguage(language)) return escapeCode(text);
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeCode(text);
  }
}

export function codeLanguage(path?: string): string | undefined {
  const extension = path?.match(/\.([a-z\d]+)$/i)?.[1]?.toLowerCase();
  return extension
    ? (
        {
          js: "javascript",
          jsx: "javascript",
          mjs: "javascript",
          cjs: "javascript",
          ts: "typescript",
          tsx: "typescript",
          json: "json",
          css: "css",
          html: "xml",
          htm: "xml",
          xml: "xml",
          svg: "xml",
          sh: "bash",
          bash: "bash",
          py: "python",
          diff: "diff",
          patch: "diff",
          glsl: "glsl",
          vert: "glsl",
          frag: "glsl",
        } as Record<string, string>
      )[extension]
    : undefined;
}
