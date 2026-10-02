/**
 * `gc --older-than <N>d [--apply]` (§9.2): the old run folders under `$GENEX_EVALS_HOME/work/`
 * (workspace and snapshots) and `evidence/` (frames, grades, streams), aged by the stamp their
 * name starts with, so a clock skew in file times cannot age a run; then the snapshot server's
 * entries (`grade-copies/`, `npm-cache/` and `sandbox-scratch/` under `work/`) and the lane roots
 * an interrupted run left in the lanes folder (`<tmpdir>/genex-evals-lanes/run-*`), which have no
 * stamp and are aged by the newest modification time inside them, so anything still in use stays.
 * It lists what it would remove and removes nothing unless `--apply` is given. It never touches a
 * run that a committed baseline names (`evals/baselines/*.json`), a symlink (never followed, at
 * any level) or a folder whose name is not a run id, an abandoned run (`<runId>.abandoned-<ms>`), a
 * calibration folder or a lane root; the ledger itself is never removed. Read-only snapshot and
 * lane clones are made writable just before their removal, and the unlistable lanes folder is
 * opened only while it is read and then given its mode back.
 */
import { chmod, lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { DAY_MS } from "../../../src/shared/duration.ts";
import { baselineRunIds } from "../grade/regrade.ts";
import { LANE_ROOT_PREFIX } from "../lanes/common.ts";
import { RUN_ID_PATTERN } from "../ledger/types.ts";
import { baselineFault } from "../report/baseline.ts";
import { parseCliArgs } from "./args.ts";
import { type CliContext, systemCliContext } from "./context.ts";
import { CliExit, type Out } from "./exit.ts";

const MESSAGE = {
  usage: "usage: gc --older-than <days>d [--apply]",
  wouldRemove: "would remove",
  removed: "removed",
  keptBaseline: "kept (baseline)",
  keptSymlink: "kept (symlink)",
  refusedBaseline: "refused baseline",
} as const;

const OLDER_THAN_FLAG = "--older-than";
const APPLY_FLAG = "--apply";
/** `30d`: whole days, at most 9999. */
const AGE_PATTERN = /^(\d{1,4})d$/;
/** `<runId>.abandoned-<ms>`: a run folder `campaign run` set aside before rerunning it. */
const ABANDONED_PATTERN = /^(.+)\.abandoned-\d+$/;
/** `calibration-<stamp>`: a calibration's work or evidence folder. */
const CALIBRATION_PATTERN = /^calibration-(\d{8}T\d{6})$/;
/** The `yyyymmddThhmmss` (UTC) stamp every run id starts with. */
const STAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/;
/** Owner-only access, for making a read-only clone removable and listing the lanes folder. */
const OWNER_RWX = 0o700;
/** The permission bits of a mode. */
const PERMISSION_BITS = 0o777;

/** One entry `gc` may remove: where it is, the run it belongs to (null when none) and its age. */
interface GcEntry {
  dir: string;
  shown: string;
  runId: string | null;
  stampedAt: number;
}

/** What one folder holds for `gc`: the entries it may remove and the links it refuses to follow. */
interface Found {
  entries: GcEntry[];
  links: string[];
}

const NOTHING: Found = { entries: [], links: [] };

/** The epoch time of a name's stamp, or null. */
function stampTime(name: string): number | null {
  const parts = STAMP_PATTERN.exec(name)?.slice(1).map(Number);
  if (!parts) return null;
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parts;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** The run a folder name belongs to, "" for a calibration folder, or null when `gc` leaves it alone. */
function ownerOf(name: string): string | null {
  if (CALIBRATION_PATTERN.test(name)) return "";
  const runId = ABANDONED_PATTERN.exec(name)?.[1] ?? name;
  return RUN_ID_PATTERN.test(runId) ? runId : null;
}

/**
 * The first folder from just under `home` down to `root` that is a link, or null. The home itself
 * is the configured root and is read as given; everything below it is never followed.
 */
async function linkOnTheWay(home: string, root: string): Promise<string | null> {
  const relative = path.relative(home, root);
  const below = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (!below) return null;
  const parts = relative.split(path.sep);
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const at = path.join(home, ...parts.slice(0, depth));
    const info = await lstat(at).catch(() => null);
    if (info === null) return null;
    if (info.isSymbolicLink()) return at;
  }
  return null;
}

/** What `read` finds in a folder under `home`, or only the link on the way to it when one is there. */
async function unlessLinked(home: string, root: string, read: () => Promise<Found>): Promise<Found> {
  const link = await linkOnTheWay(home, root);
  return link === null ? read() : { entries: [], links: [path.relative(home, link)] };
}

/** Every run folder under `root` that `gc` knows, with the symlinks it refuses to follow. */
async function entriesUnder(home: string, root: string): Promise<Found> {
  const names = await readdir(root).catch(() => [] as string[]);
  const entries: GcEntry[] = [];
  const links: string[] = [];
  for (const name of names.sort()) {
    const owner = ownerOf(name);
    const stampedAt = owner === null ? null : stampTime(owner || (CALIBRATION_PATTERN.exec(name)?.[1] ?? ""));
    if (owner === null || stampedAt === null) continue;
    const dir = path.join(root, name);
    const shown = path.relative(home, dir);
    const info = await lstat(dir);
    if (info.isSymbolicLink()) links.push(shown);
    else if (info.isDirectory()) entries.push({ dir, shown, runId: owner || null, stampedAt });
  }
  return { entries, links };
}

/** The newest modification time of `entry` and everything inside it, never through a link. */
async function lastTouched(entry: string): Promise<number> {
  const info = await lstat(entry);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const child of await readdir(entry).catch(() => [] as string[]))
    newest = Math.max(newest, await lastTouched(path.join(entry, child)));
  return newest;
}

/** Which entries of a touch-aged folder `gc` sweeps, and how it shows them. */
interface TouchedFolder {
  root: string;
  shown: (target: string) => string;
  /** Whether an entry of this name, file or folder, is one `gc` may remove. */
  accepts: (name: string, isDirectory: boolean) => boolean;
}

/** The entries of a touch-aged folder, each aged by `lastTouched`; a folder that is a link yields only that link. */
async function touchedEntries(folder: TouchedFolder): Promise<Found> {
  const info = await lstat(folder.root).catch(() => null);
  if (info?.isSymbolicLink()) return { entries: [], links: [folder.shown(folder.root)] };
  if (!info?.isDirectory()) return NOTHING;
  const entries: GcEntry[] = [];
  const links: string[] = [];
  for (const name of (await readdir(folder.root)).sort()) {
    const dir = path.join(folder.root, name);
    const entry = await lstat(dir);
    if (entry.isSymbolicLink()) links.push(folder.shown(dir));
    else if (folder.accepts(name, entry.isDirectory()))
      entries.push({ dir, shown: folder.shown(dir), runId: null, stampedAt: await lastTouched(dir) });
  }
  return { entries, links };
}

/** The lanes folder's leftover lane roots: the unlistable folder is opened to read it, then given its mode back. */
async function laneRootEntries(lanes: string): Promise<Found> {
  const info = await lstat(lanes).catch(() => null);
  const folder: TouchedFolder = {
    root: lanes,
    shown: (target) => target,
    accepts: (name, isDirectory) => isDirectory && name.startsWith(LANE_ROOT_PREFIX),
  };
  if (!info?.isDirectory()) return touchedEntries(folder);
  await chmod(lanes, OWNER_RWX);
  try {
    return await touchedEntries(folder);
  } finally {
    await chmod(lanes, info.mode & PERMISSION_BITS);
  }
}

/** Give the owner write access to every folder under `dir` (never through a symlink), so it can be removed. */
async function unlock(dir: string): Promise<void> {
  if (!(await lstat(dir)).isDirectory()) return;
  await chmod(dir, OWNER_RWX);
  for (const entry of await readdir(dir, { withFileTypes: true }))
    if (entry.isDirectory()) await unlock(path.join(dir, entry.name));
}

/** What one sweep keeps and whether it removes. */
interface SweepRule {
  cutoff: number;
  kept: ReadonlySet<string>;
  apply: boolean;
}

/** List (or remove, under `apply`) the entries older than the cutoff; answers how many were old enough. */
async function sweep(found: Found, rule: SweepRule, out: Out): Promise<number> {
  for (const shown of found.links) out(`${MESSAGE.keptSymlink} ${shown}`);
  let removable = 0;
  for (const entry of found.entries.filter((candidate) => candidate.stampedAt < rule.cutoff)) {
    if (entry.runId !== null && rule.kept.has(entry.runId)) {
      out(`${MESSAGE.keptBaseline} ${entry.shown}`);
      continue;
    }
    removable += 1;
    if (!rule.apply) {
      out(`${MESSAGE.wouldRemove} ${entry.shown}`);
      continue;
    }
    await unlock(entry.dir);
    await rm(entry.dir, { recursive: true });
    out(`${MESSAGE.removed} ${entry.shown}`);
  }
  return removable;
}

/** Every folder `gc` reads, in the order it reports them: run folders, the snapshot server's, then the lanes. */
function foldersOf(ctx: CliContext): Array<() => Promise<Found>> {
  const { paths } = ctx;
  const inHome = (target: string) => path.relative(paths.home, target);
  const cache = (root: string) => () =>
    unlessLinked(paths.home, root, () => touchedEntries({ root, shown: inHome, accepts: () => true }));
  const runs = (root: string) => () => unlessLinked(paths.home, root, () => entriesUnder(paths.home, root));
  return [
    runs(paths.work),
    runs(paths.evidence),
    cache(paths.serveCopies),
    cache(paths.npmCache),
    cache(paths.sandboxScratch),
    () => laneRootEntries(ctx.lanes),
  ];
}

/** A folder's findings with the links an earlier folder already reported left out, so each link shows once. */
function unreported(found: Found, reported: Set<string>): Found {
  const links = found.links.filter((shown) => !reported.has(shown));
  for (const shown of links) reported.add(shown);
  return { ...found, links };
}

/** The parsed command line: the age in days and whether to remove, or null. */
function parseGc(args: readonly string[]): { days: number; apply: boolean } | null {
  const parsed = parseCliArgs(args, { switches: [APPLY_FLAG], values: [OLDER_THAN_FLAG] });
  const days = AGE_PATTERN.exec(parsed?.values.get(OLDER_THAN_FLAG) ?? "")?.[1];
  if (parsed === null || parsed.positional.length > 0 || days === undefined) return null;
  return { days: Number(days), apply: parsed.switches.has(APPLY_FLAG) };
}

/** The `gc` command handler. */
export async function gcCommand(args: readonly string[], out: Out = console.log, given?: CliContext): Promise<number> {
  const request = parseGc(args);
  if (request === null) {
    out(MESSAGE.usage);
    return CliExit.Usage;
  }
  const ctx = given ?? systemCliContext();
  let kept: Set<string>;
  try {
    kept = new Set(await baselineRunIds(ctx.root));
  } catch (error) {
    const field = baselineFault(error);
    if (field === null) throw error;
    out(`${MESSAGE.refusedBaseline} ${field}`);
    return CliExit.Refused;
  }
  const rule: SweepRule = { cutoff: ctx.now().getTime() - request.days * DAY_MS, kept, apply: request.apply };
  let removable = 0;
  const reported = new Set<string>();
  for (const read of foldersOf(ctx)) removable += await sweep(unreported(await read(), reported), rule, out);
  out(`gc: ${removable} older than ${request.days}d${request.apply ? " removed" : "; dry run, --apply removes"}`);
  return CliExit.Ok;
}
