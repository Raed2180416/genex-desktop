/**
 * The worker's handover. A provider session re-sends its whole history with every request, so a
 * builder that keeps one session round after round pays for everything it has ever read on every
 * step (one worker's request carried 999,155 tokens). Once its context passes the limit, at the end
 * of a round that has a next one, the session writes what it knows into its own notes, and the
 * next round starts a fresh session on the full prompt, which points at them. Off unless the run or
 * the studio's environment turns it on.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { commitAll, GIT, resetClean } from "../../git.ts";
import { facetNotes } from "../../repo.ts";
import { RunEvent } from "../../run-events.ts";
import { isCommit } from "../../shell.ts";
import { MINUTE_MS } from "../../time.ts";
import type { FacetLoop, FacetRound } from "../state.ts";
import type { RoundFlow } from "../flow.ts";
import { HANDOVER_HEADING, handoverAsk } from "../handover-prompts.ts";
import { roundFields } from "../record.ts";
import { stopSignal, tooLateToStart } from "../rules.ts";

/** The context, in the provider's own count of the last request, past which a worker hands over. */
export const WORKER_HANDOVER_TOKENS = 500_000;
/** The handover turn's own budget: a notes file, not a round. */
const HANDOVER_TURN_MS = 5 * MINUTE_MS;
/**
 * The studio's environment variable that turns the handover on for a run whose budgets do not
 * say (shared/protocol.ts `WORKER_HANDOVER_ENV`, which this copies): "1" turns it on.
 */
export const WORKER_HANDOVER_ENV = "STUDIO_WORKER_HANDOVER";

/** Is the handover on? The run's own `budgets.workerHandover` wins, then the studio's environment. */
export function handoverOn(
  budgets: { workerHandover?: unknown },
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (typeof budgets.workerHandover === "boolean") return budgets.workerHandover;
  return env[WORKER_HANDOVER_ENV] === "1";
}

/** The round's last phase: a session past its limit writes its handover and is let go. */
export async function handOver(loop: FacetLoop, round: FacetRound): Promise<RoundFlow> {
  if (!(await handoverDue(loop, round))) return null;
  const notesFile = facetNotes(loop.facet.id);
  const contextTokens = loop.lastContextTokens;
  const wrote = await writeHandover(loop, round, notesFile);
  // Written or not, the next round starts fresh: its prompt and the committed code are enough.
  loop.sessionId = null;
  loop.lastContextTokens = null;
  loop.handoverNotes = wrote ? notesFile : null;
  await loop.appendRun(RunEvent.FacetHandover, {
    ...roundFields(loop, round.iteration),
    contextTokens,
    limitTokens: WORKER_HANDOVER_TOKENS,
    wrote,
  });
  return null;
}

/** A session over the limit, on a round with a next one: never one the facet is ending on. */
async function handoverDue(loop: FacetLoop, round: FacetRound): Promise<boolean> {
  const { ctx, deadline } = loop;
  const resumable = loop.delegated && Boolean(loop.sessionId) && typeof round.delegate === "function";
  if (!resumable || ctx.cancelled || !handoverOn(loop.budgets)) return false;
  if ((loop.lastContextTokens ?? 0) < WORKER_HANDOVER_TOKENS) return false;
  if (round.iteration >= loop.maxIterations) return false;
  if (stopSignal(await loop.finishRequested(loop.iterationsThisRound).catch(() => null))) return false;
  return !tooLateToStart({ leftMs: deadline - Date.now(), ...loop.roundEstimate() });
}

/**
 * The handover turn, in the session that remembers the round. Answers whether the notes now hold
 * a handover: a turn that only replied wrote none, and the fresh session is not sent to read one.
 */
async function writeHandover(loop: FacetLoop, round: FacetRound, notesFile: string): Promise<boolean> {
  const turn = await round.delegate(handoverAsk(notesFile), loop.sessionId, HANDOVER_TURN_MS, null).catch(() => null);
  const file = loop.workdir ? path.join(loop.workdir, notesFile) : null;
  const notes = file ? await readFile(file, "utf8").catch(() => null) : null;
  const wrote = turn?.ok === true && Boolean(notes?.split("\n").some((line) => line.trim() === HANDOVER_HEADING));
  if (file) await keepOnlyNotes(loop, round, { file, notes: wrote ? notes : null });
  return wrote;
}

/**
 * Worktree mode: whatever else the turn touched is put back, and the handover is committed onto
 * the accepted build, which it becomes. A reset in a later round (an outage's retry, a lost
 * build's rollback) goes back to that commit, so it keeps the handover.
 */
async function keepOnlyNotes(
  loop: FacetLoop,
  round: FacetRound,
  { file, notes }: { file: string; notes: string | null },
): Promise<void> {
  const { ctx, facet, git, gitOptions, gitWhere, incumbentCommit, worktree } = loop;
  if (!worktree || !isCommit(incumbentCommit)) return;
  await resetClean(ctx, gitWhere, incumbentCommit, { ...gitOptions, bestEffort: true });
  if (notes === null) return;
  await mkdir(path.dirname(file), { recursive: true }).catch(() => {});
  await writeFile(file, notes).catch(() => {});
  try {
    await commitAll(ctx, gitWhere, `facet ${facet.id} iteration ${round.iteration}: handover notes`, gitOptions);
    loop.incumbentCommit = await git(GIT.head);
  } catch {
    // Left uncommitted, the next round's session still finds it; only a reset would take it.
  }
}
