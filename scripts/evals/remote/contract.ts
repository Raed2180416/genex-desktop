/**
 * The HTTP contract between this repository and genex-demo's Genex API for desktop evals (§9.4,
 * §20, D12). genex-demo implements these routes; `ledger publish`, `ledger share` and the app's
 * field-row sender call them. Everything here is public by construction (the desktop repo is
 * open source), so security never depends on the client: the server authenticates, validates the
 * same closed schemas, rate-limits and can switch the anonymous route off.
 *
 * Two surfaces, kept apart:
 * - owner uploads under `/api/evals/desktop/*`, authenticated by a scoped `evals_ingest` key
 *   (`genex_sk_v1_…`, minted by an admin, allowed on these three routes and nothing else);
 * - anonymous contributions under `/api/desktop/contributions`, sent with **no** Authorization
 *   header and no cookies, so nothing links a row to a Genex account. Every contribution request,
 *   POST and DELETE, carries the install's device-held secret (`INSTALL_SECRET_HEADER`): the server
 *   keeps an HMAC of it, and the first secret an install id arrives with owns that id.
 *
 * The values the app's own field-row sender needs live in `src/shared/run-sharing.ts` (the app
 * never imports `scripts/`) and are re-exported here, so there is one spelling of each.
 */
import {
  CONTRIBUTION_MAX_BYTES,
  CONTRIBUTIONS_PATH,
  ContributionKind,
  contributionDeletePath,
  DEFAULT_RUNS_ORIGIN,
  type FieldRow,
  INSTALL_SECRET_HEADER,
  INSTALL_SECRET_PATTERN,
  RUNS_ORIGIN_ENV,
} from "../../../src/shared/run-sharing.ts";
import type { RunRow } from "../ledger/types.ts";

export { CONTRIBUTION_MAX_BYTES, DEFAULT_RUNS_ORIGIN, INSTALL_SECRET_HEADER, INSTALL_SECRET_PATTERN, RUNS_ORIGIN_ENV };

/** The routes, as path templates; `:runId` and `:installId` are filled by the helpers below. */
export const DesktopEvalRoute = {
  /** POST: upsert one run from its current grade (idempotent on `runId`). */
  Runs: "/api/evals/desktop/runs",
  /** POST: upsert one grade of a run (idempotent on (`runId`, `gradeSeq`)); the run keeps its highest grade. */
  Grades: "/api/evals/desktop/runs/:runId/grades",
  /** POST: presign evidence uploads for a run. */
  Evidence: "/api/evals/desktop/runs/:runId/evidence",
  /** POST: one anonymous contribution, with the install's secret in `INSTALL_SECRET_HEADER`. */
  Contributions: CONTRIBUTIONS_PATH,
  /** DELETE: every contribution of an install, proven by its secret; open while the kill switch is on. */
  Contribution: `${CONTRIBUTIONS_PATH}/:installId`,
} as const;
export type DesktopEvalRoute = (typeof DesktopEvalRoute)[keyof typeof DesktopEvalRoute];

/** The HTTP method each route takes. */
export const DESKTOP_EVAL_METHOD: Record<DesktopEvalRoute, "POST" | "DELETE"> = {
  [DesktopEvalRoute.Runs]: "POST",
  [DesktopEvalRoute.Grades]: "POST",
  [DesktopEvalRoute.Evidence]: "POST",
  [DesktopEvalRoute.Contributions]: "POST",
  [DesktopEvalRoute.Contribution]: "DELETE",
};

/** The routes an `evals_ingest` key may reach, and no other. */
export const EVALS_INGEST_ROUTES: readonly DesktopEvalRoute[] = [
  DesktopEvalRoute.Runs,
  DesktopEvalRoute.Grades,
  DesktopEvalRoute.Evidence,
];

/** The routes that take no credential at all. */
export const ANONYMOUS_ROUTES: readonly DesktopEvalRoute[] = [
  DesktopEvalRoute.Contributions,
  DesktopEvalRoute.Contribution,
];

/**
 * The admin read routes (GET, a full admin session only, never an ingest key): genex-demo's
 * `/admin/evals/desktop` pages read them. Nothing in this repository calls them.
 */
export const DesktopEvalAdminRoute = {
  /** GET: the newest desktop runs, with the scorecard's fields. */
  Runs: DesktopEvalRoute.Runs,
  /** GET: one run with its grades and signed evidence URLs. */
  Run: "/api/evals/desktop/runs/:runId",
  /** GET: the field aggregates of contributions. */
  Field: "/api/evals/desktop/field",
} as const;
export type DesktopEvalAdminRoute = (typeof DesktopEvalAdminRoute)[keyof typeof DesktopEvalAdminRoute];

/** The environment variable naming the ingest key file (`$GENEX_EVALS_HOME/secrets/genex-evals.key` by default). */
export const EVALS_KEY_FILE_ENV = "GENEX_EVALS_KEY_FILE";
/** The ingest key's prefix; the whole key is `genex_sk_v1_` plus its body and is never printed. */
export const EVALS_INGEST_KEY_PREFIX = "genex_sk_v1_";
/** How the ingest key travels: `Authorization: Bearer <key>`. */
export const EVALS_INGEST_HEADER = "authorization";

/**
 * The largest body per contribution kind. A field row stays small (`CONTRIBUTION_MAX_BYTES`,
 * 8 KiB); a community eval row carries a whole `RunRow` (probe rows, checklist, tokens by model),
 * so its kind gets 32 KiB. genex-demo's route enforces the same table.
 */
export const COMMUNITY_EVAL_MAX_BYTES = 32 * 1024;
export const CONTRIBUTION_MAX_BYTES_BY_KIND: Readonly<Record<ContributionKind, number>> = {
  [ContributionKind.Field]: CONTRIBUTION_MAX_BYTES,
  [ContributionKind.CommunityEval]: COMMUNITY_EVAL_MAX_BYTES,
};
/** Per-install daily contribution cap, counting new rows only; `ledger share` sends at most this many per run. */
export const CONTRIBUTION_DAILY_CAP_PER_INSTALL = 20;
/** How long a presigned PUT lives. */
export const EVIDENCE_PRESIGN_TTL_S = 5 * 60;
/** Per-frame and per-video size caps for presigned evidence. */
export const EVIDENCE_MAX_FRAME_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** How many evidence objects one run may upload. */
export const EVIDENCE_MAX_OBJECTS_PER_RUN = 24;
/** Days evidence and contributions are kept. */
export const EVIDENCE_RETENTION_DAYS = 180;

/** The content types evidence may carry: the prober's frames are PNG, older frames JPEG, videos WebM. */
export const EvidenceContentType = {
  Png: "image/png",
  Jpeg: "image/jpeg",
  Webm: "video/webm",
} as const;
export type EvidenceContentType = (typeof EvidenceContentType)[keyof typeof EvidenceContentType];

/** The status codes the routes answer with. */
export const DesktopEvalStatus = {
  Ok: 200,
  Created: 201,
  NoContent: 204,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  PayloadTooLarge: 413,
  RateLimited: 429,
  /**
   * The kill switch (`DESKTOP_CONTRIBUTIONS=off`), on a contribution POST only: the client stops
   * sending and Settings says sharing is paused. DELETE stays open while the switch is on (the
   * server never answers it with 410), so an install can always delete what it shared.
   */
  Gone: 410,
  /** Evidence presign on a stand with no private bucket configured (`evidence-unavailable`). */
  ServiceUnavailable: 503,
} as const;
export type DesktopEvalStatus = (typeof DesktopEvalStatus)[keyof typeof DesktopEvalStatus];

/** Error codes an error body carries; never free text. */
export const DesktopEvalErrorCode = {
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  InvalidRow: "invalid-row",
  HoldoutRefused: "holdout-refused",
  TooLarge: "too-large",
  RateLimited: "rate-limited",
  /** With status 410, to a contribution POST only; a DELETE is never paused. */
  ContributionsPaused: "contributions-paused",
  NotFound: "not-found",
  /** A contribution's install secret is missing or malformed (400), or not the one that owns the id (403). */
  InvalidProof: "invalid-proof",
  /** With status 503: the stand has no private evidence bucket, so nothing can be presigned. */
  EvidenceUnavailable: "evidence-unavailable",
} as const;
export type DesktopEvalErrorCode = (typeof DesktopEvalErrorCode)[keyof typeof DesktopEvalErrorCode];

/**
 * A non-2xx answer from these routes: `error` mirrors `code` (genex-demo's 5xx reporting reads
 * it). Other layers answer in their own shapes: a credential-scope refusal is 403
 * `{error: "credential_scope", credentialClass, message, allowed}` with no `code`, and a global
 * body limit may answer 413 `{error: "body too large"}`. A client reads `code` when it is one of
 * ours and otherwise goes by the status alone.
 */
export interface DesktopEvalError {
  error: DesktopEvalErrorCode;
  code: DesktopEvalErrorCode;
  /** When rate-limited: seconds until the next try. */
  retryAfterS?: number;
}

/** POST `Runs`: the run's current grade (highest `gradeSeq`) and the eval code's SHA it was written by. */
export interface PublishRunRequest {
  row: RunRow;
  evalSha: string;
}
export interface PublishRunResponse {
  runId: string;
  /** `false` when the row already existed and was replaced. */
  created: boolean;
}

/**
 * POST `Grades`: one grade of a published run. The server also refreshes the run's typed columns
 * and metrics from the highest `gradeSeq` it holds, so an older grade never overwrites a newer one.
 */
export interface PublishGradeRequest {
  row: RunRow;
}
export interface PublishGradeResponse {
  runId: string;
  gradeSeq: number;
  created: boolean;
}

/** One evidence object the client wants to upload. */
export interface EvidenceUploadAsk {
  /**
   * The object's index inside the run, `0 … EVIDENCE_MAX_OBJECTS_PER_RUN - 1`; the server fixes the
   * key to `desktop/<runId>/<index>.<ext>`. An index keeps its content type once presigned: asking
   * again with another type is 400 `invalid-row`.
   */
  index: number;
  contentType: EvidenceContentType;
  bytes: number;
  sha256: string;
}
/** POST `Evidence`. */
export interface PresignEvidenceRequest {
  objects: EvidenceUploadAsk[];
}
/**
 * One presigned PUT; the client sends exactly `headers` and the bytes, nothing else. The signature
 * covers Content-Type and Content-Length, so the body must be exactly the asked `bytes` long and
 * typed as asked (R2 refuses anything else).
 */
export interface PresignedUpload {
  index: number;
  url: string;
  method: "PUT";
  /** Exactly `{"content-type": <the asked content type>}`. */
  headers: Record<string, string>;
  expiresAt: string;
}
export interface PresignEvidenceResponse {
  uploads: PresignedUpload[];
}

/**
 * A public-case eval row shared by hand (`ledger share`), anonymously. The server upserts it on
 * (`installId`, `kind`, `row.runId`, `row.gradeSeq`) and counts only a new row against the
 * per-install daily cap, so a row sent twice is stored and counted once.
 */
export interface CommunityEvalContribution {
  kind: typeof ContributionKind.CommunityEval;
  installId: string;
  consentVersion: string;
  row: RunRow;
}

/**
 * POST `Contributions`: a field row from a real build, or a community eval row, at most
 * `CONTRIBUTION_MAX_BYTES_BY_KIND[kind]` long. No Authorization header, ever; the install's secret
 * in `INSTALL_SECRET_HEADER` is required (missing or malformed: 400 `invalid-proof`; another
 * install's id: 403 `invalid-proof`).
 */
export type ContributionRequest = FieldRow | CommunityEvalContribution;
/** 201 on accept; the server keeps no IP, user agent or account with the row. */
export interface ContributionResponse {
  accepted: true;
}

/** DELETE `Contribution`: the install id in the path, its secret in `INSTALL_SECRET_HEADER`, no body. */
export interface DeleteContributionsResponse {
  installId: string;
  deleted: number;
}

/** The path for a run's grades. */
export function gradesPath(runId: string): string {
  return DesktopEvalRoute.Grades.replace(":runId", encodeURIComponent(runId));
}

/** The path for a run's evidence presign. */
export function evidencePath(runId: string): string {
  return DesktopEvalRoute.Evidence.replace(":runId", encodeURIComponent(runId));
}

/** The path that deletes an install's contributions (the app's own `contributionDeletePath`). */
export function contributionPath(installId: string): string {
  return contributionDeletePath(installId);
}
