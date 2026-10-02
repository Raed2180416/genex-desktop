/**
 * `look-at-page <url> [--out shot.png]`: the one browser both raw lanes get (D10). It opens a
 * loopback URL in headless Chromium, prints the page's console errors and saves a screenshot inside
 * the current folder. `file:`, every non-loopback host and a screenshot outside the current folder
 * are refused before a browser starts. Raw lanes reach it through a PATH shim that runs an
 * installed copy (`look-at-page-tool.ts`), so this module imports only Node, `duration.ts` and
 * Playwright: the copy must run outside the checkout.
 */
import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SECOND_MS } from "../../../src/shared/duration.ts";

/** The command's name on PATH. */
export const LOOK_AT_PAGE_COMMAND = "look-at-page";
/** How long the page may take to load. */
const LOAD_TIMEOUT_MS = 30 * SECOND_MS;
/** How long the page runs after load before the screenshot, so a first frame and early errors land. */
const SETTLE_MS = 3 * SECOND_MS;
/** Where the screenshot goes when `--out` is not given. */
const DEFAULT_OUT = "look-at-page.png";
/** The exit codes a caller can tell apart. */
export const LOOK_EXIT = { Ok: 0, Failed: 1, Refused: 2 } as const;

/** Why a call was refused before any browser started. */
export const LookRefusal = {
  Usage: "usage",
  NotUrl: "not-url",
  NotHttp: "not-http",
  NotLoopback: "not-loopback",
  OutNotPng: "out-not-png",
  OutOutsideCwd: "out-outside-cwd",
} as const;
export type LookRefusal = (typeof LookRefusal)[keyof typeof LookRefusal];

/** A parsed call: the URL and the screenshot path, or the refusal. */
export type LookRequest = { ok: true; url: URL; out: string } | { ok: false; refusal: LookRefusal };

/** Loopback host names: `localhost` exactly, 127.0.0.0/8, and `[::1]`. */
export function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = hostname.split(".");
  const numeric = octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  return numeric && octets[0] === "127";
}

/** A URL the command may open: http(s) on a loopback host, with no credentials. */
function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; refusal: LookRefusal } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, refusal: LookRefusal.NotUrl };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, refusal: LookRefusal.NotHttp };
  const credentials = url.username !== "" || url.password !== "";
  if (credentials || !isLoopbackHost(url.hostname)) return { ok: false, refusal: LookRefusal.NotLoopback };
  return { ok: true, url };
}

/** The screenshot path: a `.png` inside `cwd` (lexically; `resolveOut` settles links). */
function checkOut(raw: string, cwd: string): { ok: true; out: string } | { ok: false; refusal: LookRefusal } {
  if (path.extname(raw).toLowerCase() !== ".png") return { ok: false, refusal: LookRefusal.OutNotPng };
  const out = path.resolve(cwd, raw);
  if (!out.startsWith(path.resolve(cwd) + path.sep)) return { ok: false, refusal: LookRefusal.OutOutsideCwd };
  return { ok: true, out };
}

/** Parse `<url> [--out shot.png]` against the current folder. */
export function parseLookArgs(args: readonly string[], cwd: string): LookRequest {
  const [raw, flag, value, ...extra] = args;
  const hasOut = flag !== undefined;
  const malformed = !raw || extra.length > 0 || (hasOut && (flag !== "--out" || !value));
  if (malformed) return { ok: false, refusal: LookRefusal.Usage };
  const url = checkUrl(raw);
  if (!url.ok) return url;
  const out = checkOut(hasOut ? (value ?? "") : DEFAULT_OUT, cwd);
  if (!out.ok) return out;
  return { ok: true, url: url.url, out: out.out };
}

/** The screenshot path with its folder's links resolved; refused when the real folder leaves `cwd`. */
export async function resolveOut(out: string, cwd: string): Promise<string | null> {
  const realCwd = await realpath(cwd);
  const dir = await realpath(path.dirname(out)).catch(() => null);
  if (!dir || (dir !== realCwd && !dir.startsWith(realCwd + path.sep))) return null;
  return path.join(dir, path.basename(out));
}

/** What a look saw. */
export interface LookResult {
  status: number | null;
  consoleErrors: string[];
  screenshot: string;
}

/** The browser half, injectable: opens the URL, collects errors, saves the screenshot. */
export type LookBrowser = (url: URL, out: string) => Promise<LookResult>;

/**
 * Headless Chromium from the pinned `@playwright/test`: never downloaded here. A main-frame
 * navigation away from loopback is aborted, so a redirect cannot carry the look off the machine.
 */
export const playwrightLook: LookBrowser = async (url, out) => {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.route("**/*", (route) => {
      const request = route.request();
      const leaves = request.isNavigationRequest() && !checkUrl(request.url()).ok;
      return leaves ? route.abort() : route.continue();
    });
    const response = await page.goto(url.href, { timeout: LOAD_TIMEOUT_MS, waitUntil: "load" });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: out });
    return { status: response?.status() ?? null, consoleErrors, screenshot: out };
  } finally {
    await browser.close();
  }
};

/** Run the command: refuse, or look and print what the page said. Returns the exit code. */
export async function lookAtPage(
  args: readonly string[],
  options: { cwd?: string; out?: (line: string) => void; browser?: LookBrowser } = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const print = options.out ?? console.log;
  const request = parseLookArgs(args, cwd);
  if (!request.ok) {
    print(
      `${LOOK_AT_PAGE_COMMAND}: refused (${request.refusal}). Usage: ${LOOK_AT_PAGE_COMMAND} <url> [--out shot.png]`,
    );
    return LOOK_EXIT.Refused;
  }
  const out = await resolveOut(request.out, cwd);
  if (!out) {
    print(`${LOOK_AT_PAGE_COMMAND}: refused (${LookRefusal.OutOutsideCwd})`);
    return LOOK_EXIT.Refused;
  }
  try {
    const result = await (options.browser ?? playwrightLook)(request.url, out);
    print(`status: ${result.status ?? "none"}`);
    print(`console errors: ${result.consoleErrors.length}`);
    for (const error of result.consoleErrors) print(`  ${error}`);
    print(`screenshot: ${result.screenshot}`);
    return LOOK_EXIT.Ok;
  } catch (error) {
    print(`${LOOK_AT_PAGE_COMMAND}: failed: ${(error as Error).message}`);
    return LOOK_EXIT.Failed;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await lookAtPage(process.argv.slice(2));
}
