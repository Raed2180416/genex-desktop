/**
 * The rules of a Genex publish, apart from the I/O that carries it out: which phase and CLI command
 * an attempt runs, when an unknown outcome may be settled or re-checked, and which links are ours.
 */
import {
  GenexHostedStatus,
  GenexPublishJobState,
  GenexPublishKind,
  GenexPublishPhase,
  type GenexPublishJob,
  type GenexPublishState,
} from "../../shared/genex.ts";
import { SECOND_MS } from "../../shared/duration.ts";
import { stripAnsi } from "./cli.ts";
import { DEFAULT_DASHBOARD, isGenexLink } from "./http.ts";

/** A draft checked this soon after its upload is still expected to go live on its own. */
const FOREGROUND_CHECK_MS = 2 * 60 * SECOND_MS;
const FIRST_RETRY_MS = 2 * SECOND_MS;
const MAX_FOREGROUND_RETRY_MS = 15 * SECOND_MS;
/** Retries double at most this many times before settling at the cap. */
const MAX_BACKOFF_STEPS = 3;
const BACKGROUND_RETRY_MS = 30 * SECOND_MS;
/** How much of a failed CLI run's message a job keeps. */
export const PUBLISH_ERROR_TAIL_CHARS = 3000;

export const MESSAGE = {
  UnknownAfterRestart: "Upload outcome is unknown after restart. Check the deployment page before retrying.",
  CannotReach: "Genex could not be reached to check this upload. Check again later.",
  DidNotLand: "The upload did not reach Genex: the hosted game is unchanged. You can upload again.",
  CannotTell: "Genex cannot tell whether this upload went live. Check the game page, then allow a new upload.",
  StillRunning: "This upload is still running",
  NotCurrent: "That upload is no longer the current one",
  OnlyDraftUpdated: "Only the draft page was updated: the public version is unchanged. Publish again to update it.",
  AllowedNewUpload: "You checked the deployment page and allowed a new upload.",
  ConnectFirst: "Connect Genex Tools first",
  AuthorizationExpired: "Genex authorization expired. Reconnect Genex Tools before uploading.",
  NoHostedProject: "Genex did not create a hosted project for this game",
  NoStagingIdentity: "Upload recorded; staging identity is not yet available",
  RevisionMismatch: "Hosted staging revision does not match this upload yet",
  NotInGallery: "This game is not in the gallery yet",
  NothingOnline: "Nothing is online for this game yet",
  UnrecognizedLink: "Unrecognized Genex page link",
  InvalidProject: "Invalid project",
  NeedsGit: "Publishing needs git on this Mac. Install git (Xcode command line tools or Homebrew) and try again.",
  NeedsGitLfs:
    "Publishing needs git and git-lfs on this Mac (brew install git-lfs). Studio will not let the Genex CLI install software.",
} as const;

/** Genex's own record of a hosted game, read by slug. `missing`: there is no hosted project. */
export interface HostedStaging {
  revision: string | null;
  status?: string;
  missing?: boolean;
}

/** The CLI's `.genex/project.json`, or Genex's answer about the same project. Fields are unchecked JSON. */
export interface HostedMeta {
  slug?: unknown;
  id?: unknown;
  status?: unknown;
  playUrl?: unknown;
  dashboardOrigins?: unknown;
  stagingCommit?: string;
}

/** A job's phase when its outcome became unknown: `phase` then reads 'unresolved' for the panel, and Check again still needs to know a gallery listing from a promotion. */
export type InterruptedJob = GenexPublishJob & { interruptedIn?: GenexPublishJob["phase"] };
export const phaseOf = (job: GenexPublishJob): GenexPublishJob["phase"] =>
  (job as InterruptedJob).interruptedIn ?? job.phase;

const hasSlug = (meta: HostedMeta | null | undefined): meta is HostedMeta & { slug: string } =>
  typeof meta?.slug === "string" && meta.slug !== "";
const isListed = (meta: HostedMeta | null | undefined) => meta?.status === GenexHostedStatus.Published;

/**
 * The CLI phases an attempt runs, in order. A draft is one upload. Publishing always updates the
 * draft too: the first time `publish` uploads, promotes and lists in one run; a listed game's
 * draft is uploaded and then promoted, so the gallery listing is never repeated.
 */
export function publishSteps(
  meta: HostedMeta | null | undefined,
  kind: GenexPublishKind,
): [GenexPublishPhase, ...GenexPublishPhase[]] {
  if (kind === GenexPublishKind.Draft) return [GenexPublishPhase.Uploading];
  return isListed(meta) ? [GenexPublishPhase.Uploading, GenexPublishPhase.Promoting] : [GenexPublishPhase.Listing];
}

/** The phase an attempt starts in: create the hosted project once, then its first upload step. */
export function publishPhaseFor(meta: HostedMeta | null | undefined, kind: GenexPublishKind): GenexPublishPhase {
  if (!meta?.slug) return GenexPublishPhase.CreatingProject;
  return publishSteps(meta, kind)[0];
}

/** Whether an attempt's upload is verified on the draft page: every draft, and a publish of a marked export. */
export const checksDraftPage = (job: GenexPublishJob): boolean =>
  job.kind === GenexPublishKind.Draft || job.deployment !== undefined;

/** The CLI command for each upload phase. */
const CLI_ARGS_FOR_PHASE: Partial<Record<GenexPublishPhase, string[]>> = {
  [GenexPublishPhase.Uploading]: ["preview", "--no-build"],
  [GenexPublishPhase.Promoting]: ["promote"],
  [GenexPublishPhase.Listing]: ["publish", "--no-build"],
};

/** The CLI arguments that carry out an upload phase. */
export function publishArgs(phase: GenexPublishPhase): string[] {
  return [...(CLI_ARGS_FOR_PHASE[phase] ?? [])];
}

/** A running upload with no recorded outcome that no process here owns: a restart interrupted it. */
export function wasInterrupted(job: GenexPublishJob | undefined, exporting: boolean): job is GenexPublishJob {
  return job?.state === GenexPublishJobState.Running && !job.uploadedAt && !exporting;
}

/** Record that an upload's outcome is unknown after a restart. Never permission to retry it. */
export function markUnknownAfterRestart(job: GenexPublishJob): void {
  (job as InterruptedJob).interruptedIn = job.phase;
  job.state = GenexPublishJobState.Unresolved;
  job.phase = GenexPublishPhase.Unresolved;
  job.error = MESSAGE.UnknownAfterRestart;
}

/** "Check again" may ask Genex about an unresolved upload that recorded no outcome and no process here owns. */
export function canForceSettle(job: GenexPublishJob | undefined, live: boolean, force: boolean): boolean {
  return !live && force && job?.state === GenexPublishJobState.Unresolved && !job.uploadedAt;
}

/** An uploaded draft not yet verified live, whose next check is due (or forced). */
export function deploymentCheckDue(
  job: GenexPublishJob | undefined,
  live: boolean,
  force: boolean,
  now = Date.now(),
): boolean {
  if (live || !job?.uploadedAt || !checksDraftPage(job)) return false;
  if (job.phase === GenexPublishPhase.Ready) return false;
  return force || !job.nextCheckAt || Date.parse(job.nextCheckAt) <= now;
}

/** Whether Genex's record shows the upload did not happen: the draft revision, or the listing, is as before. */
export function uploadMissing(job: GenexPublishJob, before: HostedStaging, now: HostedStaging): boolean {
  if (now.missing) return true;
  const phase = phaseOf(job);
  const updatesDraft = job.kind === GenexPublishKind.Draft || phase === GenexPublishPhase.Uploading;
  if (updatesDraft) return now.revision === before.revision;
  return phase === GenexPublishPhase.Listing && now.status !== GenexHostedStatus.Published;
}

/** A publish that stopped in its draft upload never reached its promotion: the public version is unchanged. */
export const stoppedBeforePromotion = (job: GenexPublishJob): boolean =>
  job.kind === GenexPublishKind.Gallery && phaseOf(job) === GenexPublishPhase.Uploading;

/** Whether an unknown gallery upload is shown listed by Genex. */
export function listingLanded(job: GenexPublishJob, hosted: HostedStaging): boolean {
  const listing = job.kind === GenexPublishKind.Gallery && phaseOf(job) === GenexPublishPhase.Listing;
  return listing && hosted.status === GenexHostedStatus.Published;
}

/** Close a job as finished: `state` and `phase` both read `outcome`. */
export function finishJob(
  job: GenexPublishJob,
  outcome: typeof GenexPublishJobState.Done | typeof GenexPublishJobState.Failed,
  at: string,
): void {
  job.state = outcome;
  job.phase = outcome;
  job.finishedAt = at;
}

/** When to check an unverified draft again: back off while it is fresh, then poll slowly. */
export function nextDeploymentCheck(job: GenexPublishJob, now = Date.now()): { foreground: boolean; at: string } {
  const foreground = now - Date.parse(job.uploadedAt ?? "") < FOREGROUND_CHECK_MS;
  const backoff = FIRST_RETRY_MS * 2 ** Math.min(job.checkCount ?? 0, MAX_BACKOFF_STEPS);
  const delay = foreground ? Math.min(MAX_FOREGROUND_RETRY_MS, backoff) : BACKGROUND_RETRY_MS;
  return { foreground, at: new Date(now + delay).toISOString() };
}

/** The dashboard a hosted project names for itself, when it is one of ours. */
export function dashboardFor(meta: HostedMeta | null | undefined): string {
  const origin = Array.isArray(meta?.dashboardOrigins) ? meta.dashboardOrigins[0] : undefined;
  return isGenexLink(origin) ? String(origin).replace(/\/+$/, "") : DEFAULT_DASHBOARD;
}

/** Both pages of a hosted game. The CLI prints the same forms; a printed link wins when it is one of ours. */
export function publishUrls(meta: HostedMeta | null | undefined): { draftUrl?: string; galleryUrl?: string } {
  if (!hasSlug(meta)) return {};
  const dashboard = dashboardFor(meta);
  return { draftUrl: `${dashboard}/draft/${meta.slug}`, galleryUrl: `${dashboard}/world/${meta.slug}` };
}

/** Copy what the hosted project says about itself into Studio's publish record. */
export function mergeMeta(state: GenexPublishState, meta: HostedMeta | null | undefined): void {
  if (typeof meta?.slug === "string") state.slug = meta.slug;
  if (typeof meta?.id === "string") state.projectId = meta.id;
  if (meta?.status === GenexHostedStatus.Published || meta?.status === GenexHostedStatus.Draft)
    state.status = meta.status;
  if (isGenexLink(meta?.playUrl)) state.playUrl = meta.playUrl;
  Object.assign(state, publishUrls(meta));
}

/** The page link the CLI printed for sharing, when it is one of ours. */
export function shareLink(out: string): string | undefined {
  for (const line of stripAnsi(out).split("\n")) {
    if (!/page|share this link/i.test(line)) continue;
    const match = line.match(/https:\/\/[^\s)]+/);
    if (match && isGenexLink(match[0])) return match[0];
  }
  return undefined;
}

/** The staging URL the CLI printed after "Live." or "Published.": ours, or the fixture API's own origin. */
export function stagingLink(out: string, api: string): string | undefined {
  const apiUrl = new URL(api);
  const isFixtureOrigin = (value: string) => apiUrl.hostname === "127.0.0.1" && new URL(value).origin === apiUrl.origin;
  return stripAnsi(out)
    .split("\n")
    .filter((line) => /Live\.|Published\./.test(line))
    .flatMap((line) => line.match(/https?:\/\/[^\s)]+/g) ?? [])
    .find((value) => isGenexLink(value) || isFixtureOrigin(value));
}

/** Which page a "publish-open" action may open. */
export const PublishLinkTarget = { Draft: "draft", Gallery: "gallery", Play: "play" } as const;
export type PublishLinkTarget = (typeof PublishLinkTarget)[keyof typeof PublishLinkTarget];
const LINK_TARGETS = new Set<string>(Object.values(PublishLinkTarget));

/** The requested link target, defaulting to the draft page. */
export const linkTarget = (target: string | undefined): PublishLinkTarget =>
  target !== undefined && LINK_TARGETS.has(target) ? (target as PublishLinkTarget) : PublishLinkTarget.Draft;

/** The page link for a target: the play link is the verified draft, or the listed game's own. */
export function linkFor(state: GenexPublishState, target: PublishLinkTarget): string | undefined {
  if (target === PublishLinkTarget.Gallery) return state.galleryUrl;
  if (target === PublishLinkTarget.Draft) return state.draftUrl;
  return state.readyDraft?.url ?? (state.status === GenexHostedStatus.Published ? state.playUrl : undefined);
}
