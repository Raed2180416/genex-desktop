/**
 * The desktop-evals HTTP client (§9.4, §20.2–20.3, M5.2/M5.5): the owner's ingest client, which
 * sends the `evals_ingest` key to the three `/api/evals/desktop/*` routes only, and the anonymous
 * contribution client, which sends no Authorization header and no cookie, ever. Presigned evidence
 * PUTs go to the storage URL the server handed out, with exactly its headers and no credential.
 *
 * Every request omits credentials and refuses redirects, so no header can follow a redirect to
 * another host. Only idempotent requests retry, and only on a 5xx, with doubling backoff; a 4xx
 * (including the 410 kill switch and 429 rate limit) comes back as a typed `RemoteError`. Inputs
 * the server would refuse anyway (oversized bodies, evidence out of bounds, a malformed install
 * id, an unsafe presigned upload) are refused here first, before anything is sent. `fetch`,
 * sleeping, the timeout signal and the clock are injectable.
 */
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { MINUTE_MS, SECOND_MS } from "../../../src/shared/duration.ts";
import { INSTALL_ID_PATTERN } from "../../../src/shared/run-sharing.ts";
import { SHA256_PATTERN } from "../ledger/types.ts";
import {
  CONTRIBUTION_MAX_BYTES_BY_KIND,
  type ContributionRequest,
  type ContributionResponse,
  contributionPath,
  DEFAULT_RUNS_ORIGIN,
  type DeleteContributionsResponse,
  DesktopEvalErrorCode,
  DesktopEvalRoute,
  DesktopEvalStatus,
  EVALS_INGEST_HEADER,
  EVIDENCE_MAX_FRAME_BYTES,
  EVIDENCE_MAX_OBJECTS_PER_RUN,
  EVIDENCE_MAX_VIDEO_BYTES,
  EvidenceContentType,
  type EvidenceUploadAsk,
  evidencePath,
  gradesPath,
  INSTALL_SECRET_HEADER,
  INSTALL_SECRET_PATTERN,
  type PresignEvidenceRequest,
  type PresignEvidenceResponse,
  type PresignedUpload,
  type PublishGradeRequest,
  type PublishGradeResponse,
  type PublishRunRequest,
  type PublishRunResponse,
  RUNS_ORIGIN_ENV,
} from "./contract.ts";
import type { IngestKey } from "./key-file.ts";

/** How long one API request may take. */
export const REQUEST_TIMEOUT_MS = 30 * SECOND_MS;
/** How long one presigned evidence PUT may take (a video is up to 50 MiB). */
export const UPLOAD_TIMEOUT_MS = 5 * MINUTE_MS;
/** Retries after the first attempt, for idempotent requests answered with a 5xx. */
export const MAX_RETRIES = 3;
/** The first backoff; each retry waits twice the one before. */
export const RETRY_BASE_MS = 1 * SECOND_MS;
/** The largest response body read; every answer of this API is a small JSON object. */
export const RESPONSE_MAX_BYTES = 64 * 1024;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Headers a presigned upload must never ask the client to send. */
const FORBIDDEN_UPLOAD_HEADERS = new Set([EVALS_INGEST_HEADER, "cookie", INSTALL_SECRET_HEADER]);
const JSON_TYPE = "application/json";
/** The size cap of each evidence type (§20.2). */
export const EVIDENCE_MAX_BYTES_BY_TYPE: Readonly<Record<EvidenceContentType, number>> = {
  [EvidenceContentType.Png]: EVIDENCE_MAX_FRAME_BYTES,
  [EvidenceContentType.Jpeg]: EVIDENCE_MAX_FRAME_BYTES,
  [EvidenceContentType.Webm]: EVIDENCE_MAX_VIDEO_BYTES,
};
const ERROR_CODES = new Set<string>(Object.values(DesktopEvalErrorCode));

/** Why the client refused or failed a request on its own side. */
export const ClientRefusal = {
  OriginInvalid: "origin-invalid",
  BodyTooLarge: "body-too-large",
  InvalidInput: "invalid-input",
  EvidenceInvalid: "evidence-invalid",
  UploadInvalid: "upload-invalid",
  BadResponse: "bad-response",
  Network: "network",
  Timeout: "timeout",
  /** A non-2xx answer whose body carried no known code. */
  Http: "http",
} as const;
export type ClientRefusal = (typeof ClientRefusal)[keyof typeof ClientRefusal];

/** A failed or refused request: the server's typed code or the client's own, and the status if any. */
export class RemoteError extends Error {
  readonly code: DesktopEvalErrorCode | ClientRefusal;
  readonly status: number | null;
  readonly retryAfterS: number | null;
  constructor(
    code: DesktopEvalErrorCode | ClientRefusal,
    status: number | null = null,
    retryAfterS: number | null = null,
  ) {
    super(status === null ? code : `${code} (${status})`);
    this.name = "RemoteError";
    this.code = code;
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

/** Whether the server switched contributions off (410): stop sending, say sharing is paused. */
export function isKillSwitch(error: unknown): boolean {
  return error instanceof RemoteError && error.status === DesktopEvalStatus.Gone;
}

/** The side effects a client has; tests pass fakes. */
export interface Transport {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<unknown>;
  /** A signal that aborts after `ms`. */
  timeout: (ms: number) => AbortSignal;
  now: () => number;
}

const NODE_TRANSPORT: Transport = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => sleep(ms),
  timeout: (ms) => AbortSignal.timeout(ms),
  now: () => Date.now(),
};

/**
 * The API origin from the environment: the default when `STUDIO_RUNS_URL` is unset, null when a
 * fork set it empty (sharing removed), else its origin, which must be https (or http on loopback)
 * with no credentials, path or query.
 */
export function runsOrigin(env: Readonly<Record<string, string | undefined>>): string | null {
  const configured = env[RUNS_ORIGIN_ENV];
  if (configured === undefined) return DEFAULT_RUNS_ORIGIN;
  if (configured === "") return null;
  return safeOrigin(configured);
}

function safeOrigin(value: string): string {
  const url = URL.parse(value);
  if (!url || !isSafeOriginUrl(url)) throw new RemoteError(ClientRefusal.OriginInvalid);
  return url.origin;
}

function isSafeOriginUrl(url: URL): boolean {
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  const bare = !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  return secure && bare;
}

/** How one request is sent. */
interface SendPolicy {
  retries: number;
  timeoutMs: number;
}
const IDEMPOTENT: SendPolicy = { retries: MAX_RETRIES, timeoutMs: REQUEST_TIMEOUT_MS };
const ONCE: SendPolicy = { retries: 0, timeoutMs: REQUEST_TIMEOUT_MS };
const UPLOAD: SendPolicy = { retries: MAX_RETRIES, timeoutMs: UPLOAD_TIMEOUT_MS };

async function send(transport: Transport, url: string, init: RequestInit, policy: SendPolicy): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await attemptOnce(transport, url, init, policy.timeoutMs);
    if (response.status < 500 || attempt >= policy.retries) return response;
    await response.body?.cancel();
    await transport.sleep(RETRY_BASE_MS * 2 ** attempt);
  }
}

async function attemptOnce(transport: Transport, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal = transport.timeout(timeoutMs);
  try {
    return await transport.fetch(url, { ...init, signal, credentials: "omit", redirect: "error" });
  } catch {
    throw new RemoteError(signal.aborted ? ClientRefusal.Timeout : ClientRefusal.Network);
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text.length > RESPONSE_MAX_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The response's JSON when 2xx and `accept` says its shape is right; otherwise a typed error. */
async function answer<T>(response: Response, accept: (body: unknown) => body is T): Promise<T> {
  const body = await readBody(response);
  if (!response.ok) throw failure(response.status, body);
  if (!accept(body)) throw new RemoteError(ClientRefusal.BadResponse, response.status);
  return body;
}

function failure(status: number, body: unknown): RemoteError {
  const record = isRecord(body) ? body : {};
  const code = isErrorCode(record.code) ? record.code : ClientRefusal.Http;
  const retry = record.retryAfterS;
  const retryAfterS = typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? retry : null;
  return new RemoteError(code, status, retryAfterS);
}

function isErrorCode(value: unknown): value is DesktopEvalErrorCode {
  return typeof value === "string" && ERROR_CODES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isRunAnswer = (body: unknown): body is PublishRunResponse =>
  isRecord(body) && typeof body.runId === "string" && typeof body.created === "boolean";
const isGradeAnswer = (body: unknown): body is PublishGradeResponse =>
  isRecord(body) &&
  typeof body.runId === "string" &&
  typeof body.created === "boolean" &&
  Number.isInteger(body.gradeSeq);
const isPresignAnswer = (body: unknown): body is PresignEvidenceResponse =>
  isRecord(body) && Array.isArray(body.uploads) && body.uploads.every(isRecord);
const isAccepted = (body: unknown): body is ContributionResponse => isRecord(body) && body.accepted === true;
const isDeleteAnswer = (body: unknown): body is DeleteContributionsResponse =>
  isRecord(body) && typeof body.installId === "string" && Number.isInteger(body.deleted);

/** The owner's uploads, authenticated by the ingest key. */
export interface IngestClient {
  /** Upsert one run row (idempotent on `runId`). */
  publishRun(request: PublishRunRequest): Promise<PublishRunResponse>;
  /** Upsert a later grade of a published run (idempotent on (`runId`, `gradeSeq`)). */
  publishGrade(runId: string, request: PublishGradeRequest): Promise<PublishGradeResponse>;
  /** Ask for presigned PUTs for a run's evidence objects. */
  presignEvidence(runId: string, request: PresignEvidenceRequest): Promise<PresignEvidenceResponse>;
  /** PUT one evidence object to its presigned URL, with no credential. */
  uploadEvidence(upload: PresignedUpload, ask: EvidenceUploadAsk, bytes: Uint8Array): Promise<void>;
}

/** Where a client sends and how. */
export interface ClientOptions {
  origin: string;
  transport?: Partial<Transport>;
}

/** The ingest client for `ledger publish`. */
export function createIngestClient(options: ClientOptions & { key: IngestKey }): IngestClient {
  const origin = safeOrigin(options.origin);
  const transport = { ...NODE_TRANSPORT, ...options.transport };
  const post = (route: string, body: unknown) =>
    send(
      transport,
      `${origin}${route}`,
      {
        method: "POST",
        headers: { [EVALS_INGEST_HEADER]: options.key.bearer(), "content-type": JSON_TYPE, accept: JSON_TYPE },
        body: JSON.stringify(body),
      },
      IDEMPOTENT,
    );
  return {
    publishRun: async (request) => answer(await post(DesktopEvalRoute.Runs, request), isRunAnswer),
    publishGrade: async (runId, request) => answer(await post(gradesPath(runId), request), isGradeAnswer),
    presignEvidence: async (runId, request) => {
      checkEvidenceAsks(request.objects);
      return answer(await post(evidencePath(runId), request), isPresignAnswer);
    },
    uploadEvidence: async (upload, ask, bytes) => {
      const headers = uploadHeaders(upload, ask, bytes, transport.now());
      const response = await send(
        transport,
        upload.url,
        { method: "PUT", headers, body: new Uint8Array(bytes) },
        UPLOAD,
      );
      await response.body?.cancel();
      if (!response.ok) throw new RemoteError(ClientRefusal.Http, response.status);
    },
  };
}

/** The ask for one evidence object: its index, type, size and digest. */
export function evidenceAsk(index: number, contentType: EvidenceContentType, bytes: Uint8Array): EvidenceUploadAsk {
  return { index, contentType, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function checkEvidenceAsks(objects: readonly EvidenceUploadAsk[]): void {
  const indexes = new Set(objects.map((ask) => ask.index));
  const bounded = objects.length > 0 && objects.length <= EVIDENCE_MAX_OBJECTS_PER_RUN;
  if (!bounded || indexes.size !== objects.length || !objects.every(isAskInBounds))
    throw new RemoteError(ClientRefusal.EvidenceInvalid);
}

function isAskInBounds(ask: EvidenceUploadAsk): boolean {
  const cap = EVIDENCE_MAX_BYTES_BY_TYPE[ask.contentType];
  const sized = cap !== undefined && Number.isInteger(ask.bytes) && ask.bytes > 0 && ask.bytes <= cap;
  return sized && Number.isInteger(ask.index) && ask.index >= 0 && SHA256_PATTERN.test(ask.sha256);
}

/** The headers to PUT with: the presigned ones, checked; throws `upload-invalid` for anything unsafe. */
function uploadHeaders(upload: PresignedUpload, ask: EvidenceUploadAsk, bytes: Uint8Array, now: number): Headers {
  const headers = new Headers(upload.headers);
  const url = URL.parse(upload.url);
  const expires = Date.parse(upload.expiresAt);
  const safe =
    url?.protocol === "https:" &&
    !url.username &&
    !url.password &&
    upload.method === "PUT" &&
    upload.index === ask.index &&
    Number.isFinite(expires) &&
    expires > now &&
    [...FORBIDDEN_UPLOAD_HEADERS].every((name) => !headers.has(name)) &&
    (headers.get("content-type") ?? ask.contentType) === ask.contentType;
  const matches = isAskInBounds(ask) && evidenceAsk(ask.index, ask.contentType, bytes).sha256 === ask.sha256;
  if (!safe || !matches || bytes.byteLength !== ask.bytes) throw new RemoteError(ClientRefusal.UploadInvalid);
  headers.set("content-type", ask.contentType);
  return headers;
}

/** Anonymous contributions: no Authorization header and no cookie, ever. */
export interface ContributionClient {
  /**
   * Send one field row or community eval row with the install's device-held secret, which the
   * server requires on every contribution. Never retried here: a field row is not idempotent,
   * and a community eval row is resumed by the operator's next `ledger share`, which skips what
   * the server already accepted.
   */
  contribute(request: ContributionRequest, installSecret: string): Promise<ContributionResponse>;
  /** Delete every contribution of an install, proven by its device-held secret; open under the kill switch too. */
  deleteContributions(installId: string, secret: string): Promise<DeleteContributionsResponse>;
}

/** The contribution client for `ledger share` (and the app's field-row sender's contract). */
export function createContributionClient(options: ClientOptions): ContributionClient {
  const origin = safeOrigin(options.origin);
  const transport = { ...NODE_TRANSPORT, ...options.transport };
  return {
    contribute: async (request, installSecret) => {
      if (!INSTALL_SECRET_PATTERN.test(installSecret)) throw new RemoteError(ClientRefusal.InvalidInput);
      const body = JSON.stringify(request);
      const cap = CONTRIBUTION_MAX_BYTES_BY_KIND[request.kind];
      if (Buffer.byteLength(body) > cap) throw new RemoteError(ClientRefusal.BodyTooLarge);
      const headers = { "content-type": JSON_TYPE, accept: JSON_TYPE, [INSTALL_SECRET_HEADER]: installSecret };
      const response = await send(
        transport,
        `${origin}${DesktopEvalRoute.Contributions}`,
        { method: "POST", headers, body },
        ONCE,
      );
      return answer(response, isAccepted);
    },
    deleteContributions: async (installId, secret) => {
      if (!INSTALL_ID_PATTERN.test(installId) || !INSTALL_SECRET_PATTERN.test(secret))
        throw new RemoteError(ClientRefusal.InvalidInput);
      const headers = { [INSTALL_SECRET_HEADER]: secret, accept: JSON_TYPE };
      const response = await send(
        transport,
        `${origin}${contributionPath(installId)}`,
        { method: "DELETE", headers },
        IDEMPOTENT,
      );
      return answer(response, isDeleteAnswer);
    },
  };
}
