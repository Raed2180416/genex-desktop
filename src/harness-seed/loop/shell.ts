/**
 * Text on a command line the loop hands to `run.exec`, which runs it with `/bin/sh -c`.
 *
 * A judge's reason, a build error or a worker's title is written by a model. Inside double quotes
 * a backtick or `$(…)` in it still runs as a command. Single quotes run nothing, so every such
 * value reaches the shell through {@link shellQuote}.
 */

/** How much of a refused value the error that refuses it quotes. */
export const REFUSED_VALUE_CHARS = 80;

/** Single-quote a value for a POSIX shell: the program receives it exactly, and nothing in it runs. */
export function shellQuote(value: unknown): string {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * A commit as git prints one (7 to 64 hex digits), or HEAD. Anything else — a ref name a model
 * wrote, `--output=…`, `$(…)` — never reaches a command line as a revision.
 */
export function isCommit(value: unknown): value is string {
  return typeof value === "string" && (value === "HEAD" || /^[0-9a-f]{7,64}$/.test(value));
}

/** {@link isCommit}'s value, or a throw that names what was refused. */
export function commitArg(value: unknown): string {
  if (!isCommit(value))
    throw new Error(`not a commit hash: ${JSON.stringify(String(value)).slice(0, REFUSED_VALUE_CHARS)}`);
  return value;
}
