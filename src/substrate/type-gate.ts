/**
 * The in-app type gate: TypeScript 7's native compiler, vendored into the app's resources by
 * `scripts/vendor-tsc.ts`, run over a copy of the harness before the agent's own code edit is
 * accepted (`main/core/self-edit-gate.ts`).
 *
 * Layout under `resources/tsc/`:
 *
 *   <platform>-<arch>/tsc          the native compiler (`tsc.exe` on Windows), with the
 *                                  `lib.*.d.ts` files beside it
 *   node_modules/@types/node       what `types: ["node"]` in the harness tsconfig resolves to
 *   node_modules/undici-types      which @types/node imports
 *
 * The check fails closed: a build without the compiler, a harness without its tsconfig, a crash
 * or a timeout all answer "not ok" with a sentence saying so. Nothing here ever reads a missing
 * compiler as a clean result.
 */
import { access, constants, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { StudioPlatform } from "../shared/boot.ts";
import { SECOND_MS } from "../shared/duration.ts";
import { pathExists } from "./fsx.ts";
import { type ProcessSandbox, type RunResult, shellQuote } from "./spawn.ts";

/** The folder under the app's resources that holds the vendored compiler. */
export const TSC_DIR = "tsc";

/** The compiler's file name on `platform`: the platform packages ship `tsc`, or `tsc.exe` on Windows. */
function tscBinaryName(platform: string): string {
  return platform === StudioPlatform.Windows ? "tsc.exe" : "tsc";
}

export interface TscLayout {
  root: string;
  /** The native compiler for this machine. */
  binary: string;
  /** Passed as `--typeRoots`: the workspace has no node_modules of its own. */
  typeRoots: string;
}

export function tscLayout(
  resources: string,
  platform: string = process.platform,
  arch: string = process.arch,
): TscLayout {
  const root = path.join(resources, TSC_DIR);
  return {
    root,
    binary: path.join(root, `${platform}-${arch}`, tscBinaryName(platform)),
    typeRoots: path.join(root, "node_modules", "@types"),
  };
}

/** Why a check did not pass: no compiler or no project, type errors, too slow, or the compiler failed. */
export const TypeCheckFailure = {
  Unavailable: "unavailable",
  Errors: "errors",
  Timeout: "timeout",
  Crashed: "crashed",
} as const;
export type TypeCheckFailure = (typeof TypeCheckFailure)[keyof typeof TypeCheckFailure];

export type TypeCheckResult =
  | { ok: true; durationMs: number }
  | { ok: false; reason: TypeCheckFailure; message: string; diagnostics: string[] };

export interface TypeCheckOptions {
  /** The app's resources folder, which holds `tsc/`. */
  resources: string;
  /** The harness copy to check: its `tsconfig.json` is the project. */
  dir: string;
  /**
   * The compiler config to hold the copy to — the app's own, `harness-seed/tsconfig.json` — which
   * is copied over the copy's `tsconfig.json` before the check. The workspace's is the agent's to
   * edit, and an edit to it is no code change: nothing gates it, so `noCheck`, a narrowed
   * `include` or an empty `files` list would switch the check off for every later code edit.
   * Omitted, the copy's own config is used (it must exist).
   */
  config?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** One compiler diagnostic line: `loop/x.ts(12,3): error TS2322: …`. */
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export const DEFAULT_TYPE_CHECK_TIMEOUT_MS = 90 * SECOND_MS;
/** How much compiler output a check keeps: plenty for every diagnostic of a broken harness. */
const MAX_COMPILER_OUTPUT_CHARS = 512 * 1024;
/** How much of a crashed compiler's own words the failure quotes. */
const CRASH_EXCERPT_LINES = 5;
const CRASH_EXCERPT_CHARS = 400;
/** The project file the compiler reads, in the checked copy. */
const PROJECT_FILE = "tsconfig.json";
/** `typeCheckText`'s default bounds. */
const DEFAULT_TEXT_MAX_LINES = 30;
const DEFAULT_TEXT_MAX_CHARS = 4_000;

const MESSAGE = {
  CompilerMissing: (binary: string) =>
    `Studio's type checker is missing from this build (${binary}), so a code change cannot be checked.`,
  ConfigMissing: "This build has no harness tsconfig.json to check against, so a code change cannot be checked.",
  ProjectMissing: "The harness has no tsconfig.json, so a code change cannot be checked.",
  TimedOut: (timeoutMs: number) => `The type check did not finish within ${Math.round(timeoutMs / SECOND_MS)}s.`,
  Crashed: (exit: number | string | null, said: string) =>
    `The type checker failed (exit ${exit})${said ? `: ${said}` : "."}`,
  TypeErrors: (count: number) => `${count} type error${count === 1 ? "" : "s"}.`,
  Passed: "Type check passed.",
  More: (count: number) => `… and ${count} more.`,
} as const;

/**
 * Run `tsc --noEmit -p tsconfig.json` over `dir` inside the sandbox, with `dir` itself denied for
 * writing: the check reads the copy, it never changes it — past putting `config` in place first,
 * which is why `dir` must be a throwaway copy whenever `config` is passed.
 */
export async function typecheckHarness(
  sandbox: Pick<ProcessSandbox, "run">,
  options: TypeCheckOptions,
): Promise<TypeCheckResult> {
  const layout = tscLayout(options.resources);
  const problem = await projectProblem(layout, options);
  if (problem) return unavailable(problem);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TYPE_CHECK_TIMEOUT_MS;
  const command = [layout.binary, "--noEmit", "-p", PROJECT_FILE, "--typeRoots", layout.typeRoots, "--pretty", "false"]
    .map(shellQuote)
    .join(" ");
  const result = await sandbox.run({
    command,
    cwd: options.dir,
    timeoutMs,
    label: "type-gate",
    maxOutputBytes: MAX_COMPILER_OUTPUT_CHARS,
    policy: { denyWrite: [options.dir] },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return checkResult(result, timeoutMs);
}

/**
 * Why `options.dir` cannot be checked (no compiler, no config to hold it to, no project), or
 * null once it can. Puts `options.config` in place as the copy's project first when one is given.
 */
async function projectProblem(layout: TscLayout, options: TypeCheckOptions): Promise<string | null> {
  const missing = await access(layout.binary, constants.X_OK).then(
    () => false,
    () => true,
  );
  if (missing) return MESSAGE.CompilerMissing(layout.binary);
  const target = path.join(options.dir, PROJECT_FILE);
  if (options.config !== undefined) {
    if (!(await pathExists(options.config))) return MESSAGE.ConfigMissing;
    // Removed first: a `tsconfig.json` the agent made a link would otherwise be written through.
    await rm(target, { force: true, recursive: true });
    await copyFile(options.config, target, constants.COPYFILE_EXCL);
  }
  if (!(await pathExists(target))) return MESSAGE.ProjectMissing;
  return null;
}

/** The compiler run's verdict: passed, timed out, type errors, or a compiler that failed without any. */
function checkResult(result: RunResult, timeoutMs: number): TypeCheckResult {
  if (result.timedOut) return failed(TypeCheckFailure.Timeout, MESSAGE.TimedOut(timeoutMs));
  if (result.code === 0) return { ok: true, durationMs: result.durationMs };
  const diagnostics = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => DIAGNOSTIC.test(line));
  if (diagnostics.length > 0)
    return failed(TypeCheckFailure.Errors, MESSAGE.TypeErrors(diagnostics.length), diagnostics);
  const said = `${result.stderr || result.stdout}`
    .trim()
    .split("\n")
    .slice(0, CRASH_EXCERPT_LINES)
    .join(" ")
    .slice(0, CRASH_EXCERPT_CHARS);
  return failed(TypeCheckFailure.Crashed, MESSAGE.Crashed(result.code ?? result.signal, said));
}

function failed(reason: TypeCheckFailure, message: string, diagnostics: string[] = []): TypeCheckResult {
  return { ok: false, reason, message, diagnostics };
}

function unavailable(message: string): TypeCheckResult {
  return failed(TypeCheckFailure.Unavailable, message);
}

/** The diagnostics of `files` (workspace-relative), or every diagnostic when `files` is omitted. */
export function diagnosticsFor(diagnostics: readonly string[], files?: readonly string[]): string[] {
  if (!files) return [...diagnostics];
  const wanted = new Set(files.map((file) => path.posix.normalize(file)));
  return diagnostics.filter((line) => wanted.has(path.posix.normalize(DIAGNOSTIC.exec(line)?.[1] ?? "")));
}

/**
 * A check's outcome as bounded text for an agent's tool result or a notice: the sentence, then at
 * most `maxLines` diagnostics and `maxChars` characters, with how many more there were.
 */
export function typeCheckText(
  result: TypeCheckResult,
  {
    maxLines = DEFAULT_TEXT_MAX_LINES,
    maxChars = DEFAULT_TEXT_MAX_CHARS,
  }: { maxLines?: number; maxChars?: number } = {},
): string {
  if (result.ok) return MESSAGE.Passed;
  const lines = [result.message];
  let used = result.message.length;
  let shown = 0;
  for (const line of result.diagnostics) {
    if (shown >= maxLines || used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  if (shown < result.diagnostics.length) lines.push(MESSAGE.More(result.diagnostics.length - shown));
  return lines.join("\n");
}
