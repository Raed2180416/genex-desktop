/**
 * `npm run eval -- review <campaign> [--graders] [--sample N] [--seed S] [--reviewer ID]` (§8.6,
 * §10.7): build the session's tasks from the local ledger and evidence, serve them on a loopback
 * page, and write one human row per answer until every task is answered or the operator stops it.
 * The reviewer is an opaque local id kept under the evals home (minted once, random hex), never a
 * name or an email; `--reviewer` picks another id for a second reviewer on the same machine.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type CommandHandler, EXIT_USAGE } from "../cli/exit.ts";
import { readCases, readHoldoutCases } from "../cases.ts";
import type { EvalCase } from "../case-types.ts";
import { resolveEvalsHome } from "../home.ts";
import { type EvalsPaths, evalsPaths } from "../ledger/paths.ts";
import { currentRows, readHumanRows, readPairwiseRows, readRunRows } from "../ledger/read.ts";
import { REVIEWER_ID_PATTERN, SEED_PATTERN } from "../ledger/schema.ts";
import { CAMPAIGN_ID_PATTERN } from "../ledger/types.ts";
import { appendLedgerRow } from "../ledger/write.ts";
import { type ReviewServerHandle, startReviewServer, type WriteReviewRow } from "./server.ts";
import { evidenceReviewSource, loadReviewTasks, ReviewMode, type ReviewSource } from "./tasks.ts";

/** The file under the evals home that keeps this machine's reviewer id. */
export const REVIEWER_ID_FILE = "reviewer-id";
/** Random bytes in a minted reviewer id (16 hex characters). */
const REVIEWER_ID_BYTES = 8;
/** Random bytes in a session seed. */
const SESSION_SEED_BYTES = 8;
/** The exit code when the session could not start. */
export const EXIT_REVIEW_FAILED = 1;
/** The flags `review` takes. */
const Flag = {
  Graders: "--graders",
  Sample: "--sample",
  Seed: "--seed",
  Reviewer: "--reviewer",
} as const;
const WHOLE_NUMBER = /^[1-9]\d{0,5}$/;
const USAGE = `usage: review <campaign> [${Flag.Graders}] [${Flag.Sample} N] [${Flag.Seed} S] [${Flag.Reviewer} ID]`;

/** What the command prints, as codes. */
export const ReviewLine = {
  NothingToReview: "nothing-to-review",
  Serving: "serving",
  Tasks: "tasks",
  Done: "done",
  Failed: "failed",
} as const;
export type ReviewLine = (typeof ReviewLine)[keyof typeof ReviewLine];

/** A parsed `review` command line. */
export interface ReviewArgs {
  campaignId: string;
  mode: ReviewMode;
  sample: number | null;
  seed: string | null;
  reviewerId: string | null;
}

/** What the command reads, serves and writes through; tests pass fakes. */
export interface ReviewDeps {
  out: (line: string) => void;
  env?: Readonly<Record<string, string | undefined>>;
  /** The repository whose `evals/cases.md` supplies the briefs (default: the working folder). */
  repoRoot?: string;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  /** The ledger and evidence the tasks come from (default: the real ones under the home). */
  source?: (paths: EvalsPaths) => ReviewSource;
  /** Where rows go (default: the ledger writer). */
  write?: (paths: EvalsPaths) => WriteReviewRow;
  /** Resolves when the session should end (default: every task answered, or Ctrl-C). */
  untilDone?: (handle: ReviewServerHandle) => Promise<void>;
}

/** Set one flag that takes a value; false when the flag is unknown or the value malformed. */
function applyValueFlag(parsed: ReviewArgs, flag: string | undefined, value: string): boolean {
  if (flag === Flag.Sample && WHOLE_NUMBER.test(value)) {
    parsed.sample = Number(value);
    return true;
  }
  if (flag === Flag.Seed && SEED_PATTERN.test(value)) {
    parsed.seed = value;
    return true;
  }
  if (flag === Flag.Reviewer && REVIEWER_ID_PATTERN.test(value)) {
    parsed.reviewerId = value;
    return true;
  }
  return false;
}

/** `<campaign>` and its flags, or null for anything else. */
export function parseReviewArgs(args: readonly string[]): ReviewArgs | null {
  const [campaignId, ...rest] = args;
  if (!campaignId || !CAMPAIGN_ID_PATTERN.test(campaignId)) return null;
  const parsed: ReviewArgs = { campaignId, mode: ReviewMode.Pair, sample: null, seed: null, reviewerId: null };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === Flag.Graders) {
      parsed.mode = ReviewMode.GraderValidation;
      continue;
    }
    if (!applyValueFlag(parsed, flag, rest[index + 1] ?? "")) return null;
    index += 1;
  }
  return parsed;
}

const defaultRandomHex = (bytes: number) => randomBytes(bytes).toString("hex");

/** This machine's reviewer id under the evals home: read when well-formed, else minted and kept. */
export async function localReviewerId(
  home: string,
  randomHex: (bytes: number) => string = defaultRandomHex,
): Promise<string> {
  const file = path.join(home, REVIEWER_ID_FILE);
  const kept = await readFile(file, "utf8").then(
    (text) => text.trim(),
    () => null,
  );
  if (kept !== null && REVIEWER_ID_PATTERN.test(kept)) return kept;
  const minted = randomHex(REVIEWER_ID_BYTES);
  await mkdir(home, { recursive: true });
  await writeFile(file, `${minted}\n`, { mode: 0o600 });
  return minted;
}

/** The public cases of the repository and the holdouts under the home; none when a file cannot be read. */
function sessionCases(repoRoot: string, home: string): EvalCase[] {
  const read = (load: () => EvalCase[]) => {
    try {
      return load();
    } catch {
      return [];
    }
  };
  return [...read(() => readCases(repoRoot)), ...read(() => readHoldoutCases(home))];
}

/** The review source over the real ledger and evidence under `paths`. */
export function ledgerReviewSource(paths: EvalsPaths, cases: readonly EvalCase[]): ReviewSource {
  const inCampaign = <T extends { campaignId: string }>(rows: readonly T[], campaignId: string) =>
    rows.filter((row) => row.campaignId === campaignId);
  return evidenceReviewSource(
    paths.evidence,
    {
      runs: async (campaignId) => inCampaign(currentRows(await readRunRows(paths)), campaignId),
      pairwise: async (campaignId) => inCampaign(await readPairwiseRows(paths), campaignId),
      human: () => readHumanRows(paths),
    },
    cases,
  );
}

/** Settles when every task is answered or the operator presses Ctrl-C. */
function untilAnsweredOrInterrupted(handle: ReviewServerHandle): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    handle.finished.then(() => {
      process.off("SIGINT", stop);
      resolve();
    });
  });
}

/** Run one review session; returns the exit code. */
export async function runReview(args: ReviewArgs, deps: ReviewDeps): Promise<number> {
  const randomHex = deps.randomHex ?? defaultRandomHex;
  const home = resolveEvalsHome({ env: deps.env ?? process.env });
  const paths = evalsPaths(home);
  const cases = sessionCases(deps.repoRoot ?? process.cwd(), home);
  const source = deps.source ? deps.source(paths) : ledgerReviewSource(paths, cases);
  const reviewerId = args.reviewerId ?? (await localReviewerId(home, randomHex));
  const seed = args.seed ?? randomHex(SESSION_SEED_BYTES);
  const tasks = await loadReviewTasks(
    { campaignId: args.campaignId, mode: args.mode, seed, reviewerId, sample: args.sample },
    source,
  );
  if (!tasks.length) {
    deps.out(ReviewLine.NothingToReview);
    return 0;
  }
  const write = deps.write ? deps.write(paths) : (row: unknown) => appendLedgerRow(row, { paths }).then(() => {});
  const handle = await startReviewServer({
    tasks,
    evidenceRoot: paths.evidence,
    reviewerId,
    write,
    now: deps.now,
    randomHex,
  });
  try {
    deps.out(`${ReviewLine.Tasks} ${tasks.length} ${args.mode} seed=${seed} reviewer=${reviewerId}`);
    deps.out(`${ReviewLine.Serving} ${handle.url}`);
    await (deps.untilDone ?? untilAnsweredOrInterrupted)(handle);
  } finally {
    await handle.close();
  }
  const { done, total } = handle.progress();
  deps.out(`${ReviewLine.Done} ${done}/${total}`);
  return 0;
}

/** The `review` handler for the eval CLI's command table. */
export function reviewCommand(deps: ReviewDeps): CommandHandler {
  return async (args) => {
    const parsed = parseReviewArgs(args);
    if (!parsed) {
      deps.out(USAGE);
      return EXIT_USAGE;
    }
    try {
      return await runReview(parsed, deps);
    } catch (error) {
      deps.out(`${ReviewLine.Failed} ${error instanceof Error ? `${error.name}: ${error.message}` : "error"}`);
      return EXIT_REVIEW_FAILED;
    }
  };
}

/** The real terminal output; everything else defaults to the real ledger, evidence and signals. */
export function defaultReviewDeps(): ReviewDeps {
  return { out: (line) => console.log(line) };
}
