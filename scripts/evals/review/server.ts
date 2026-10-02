/**
 * The review server (§8.6, §10.7): a loopback HTTP server for one review session. It binds
 * `127.0.0.1` on a random port and answers a request only when its Host is this server and its URL
 * carries the session's random token (compared in constant time); an answer must also come from
 * this origin, as JSON, within a small size cap. Media is served by opaque per-session ids that map
 * to evidence files, each re-checked by real-path containment and sniffed before a byte goes out.
 * Every response carries `default-src 'self'` and `nosniff`, and nothing is cached. An answer
 * becomes one human row through the injected writer; a refused write leaves the task open.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SECOND_MS } from "../../../src/shared/duration.ts";
import { CheckResult, DefectCode, HumanPick, ItemVerdict } from "../vocabulary.ts";
import { type ReviewMedia, readServableMedia } from "./evidence.ts";
import { REVIEW_CSP, REVIEW_CSS, REVIEW_SCRIPT, ReviewPath, reviewPageHtml, TOKEN_PARAM, withToken } from "./page.ts";
import { graderValidationRow, pairReviewRow, type ReviewRow, type ReviewRowBase } from "./rows.ts";
import { ReviewMode, type ReviewTask } from "./tasks.ts";
import { SESSION_CODES, type SessionView, taskView } from "./view.ts";

/** The only address the review server binds. */
export const REVIEW_HOST = "127.0.0.1";
/** Random bytes in a session token. */
export const REVIEW_TOKEN_BYTES = 32;
/** Random bytes in a media id. */
const MEDIA_ID_BYTES = 16;
/** Random bytes in a task id. */
const TASK_ID_BYTES = 8;
/** The largest answer body the server reads. */
export const MAX_ANSWER_BYTES = 4 * 1024;
const MEDIA_ID = /^[0-9a-f]{32}$/;
const JSON_TYPE = "application/json";

/** The statuses the server answers with. */
const Status = {
  Ok: 200,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  Conflict: 409,
  PayloadTooLarge: 413,
  UnsupportedMediaType: 415,
  Unprocessable: 422,
} as const;
type Status = (typeof Status)[keyof typeof Status];

/** Why the server refused a request, as the JSON `error` of a refusal. */
export const ReviewRefusal = {
  ForeignHost: "foreign-host",
  BadToken: "bad-token",
  ForeignOrigin: "foreign-origin",
  Method: "method-not-allowed",
  NotFound: "not-found",
  NotJson: "not-json",
  TooLarge: "too-large",
  InvalidAnswer: "invalid-answer",
  UnknownTask: "unknown-task",
  RowRefused: "row-refused",
} as const;
export type ReviewRefusal = (typeof ReviewRefusal)[keyof typeof ReviewRefusal];

/** Appends one review row (the ledger writer in real use). */
export type WriteReviewRow = (row: ReviewRow) => Promise<void>;

/** What one session serves and where its answers go. */
export interface ReviewServerOptions {
  tasks: readonly ReviewTask[];
  /** `$GENEX_EVALS_HOME/evidence`: nothing outside it is ever read. */
  evidenceRoot: string;
  reviewerId: string;
  write: WriteReviewRow;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  /** 0 (the default) picks a free port. */
  port?: number;
}

/** A running review session. */
export interface ReviewServerHandle {
  /** The page's URL, token included. */
  url: string;
  origin: string;
  progress(): { done: number; total: number };
  /** Settles once every task is answered. */
  finished: Promise<void>;
  close(): Promise<void>;
}

/** One task inside the session. */
interface SessionTask {
  id: string;
  task: ReviewTask;
  shownAt: number | null;
  /** An answer's row is being written; a second answer meanwhile is refused, never written twice. */
  saving: boolean;
  done: boolean;
}

interface Session {
  options: ReviewServerOptions;
  token: string;
  tasks: SessionTask[];
  media: Map<string, ReviewMedia>;
  mediaIds: Map<ReviewMedia, string>;
  now: () => number;
  onDone: () => void;
}

/** A parsed answer body. */
interface AnswerBody {
  taskId: string;
  pick: HumanPick | null;
  human: ItemVerdict | null;
  defect: DefectCode;
  satisfied: { a: CheckResult; b: CheckResult };
}

const inTable =
  <T extends string>(table: Record<string, T>) =>
  (value: unknown): value is T =>
    typeof value === "string" && (Object.values(table) as readonly string[]).includes(value);
const isPick = inTable(HumanPick);
const isVerdict = inTable(ItemVerdict);
const isDefect = inTable(DefectCode);
const isCheck = inTable(CheckResult);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** An answer body, or null when any field is missing or not its code. */
export function parseAnswer(value: unknown): AnswerBody | null {
  if (!isRecord(value) || typeof value.taskId !== "string" || !isDefect(value.defect)) return null;
  const { pick, human, satisfied } = value;
  if (pick !== null && !isPick(pick)) return null;
  if (human !== null && !isVerdict(human)) return null;
  if (!isRecord(satisfied) || !isCheck(satisfied.a) || !isCheck(satisfied.b)) return null;
  return { taskId: value.taskId, pick, human, defect: value.defect, satisfied: { a: satisfied.a, b: satisfied.b } };
}

/** Whether two strings are equal, in time that does not depend on where they differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function securityHeaders(contentType: string): http.OutgoingHttpHeaders {
  return {
    "content-type": contentType,
    "content-security-policy": REVIEW_CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
  };
}

function send(response: http.ServerResponse, status: Status, contentType: string, body: string | Buffer): void {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  response.writeHead(status, { ...securityHeaders(contentType), "content-length": bytes.length });
  response.end(response.req.method === "HEAD" ? undefined : bytes);
}

function sendJson(response: http.ServerResponse, status: Status, value: unknown): void {
  send(response, status, `${JSON_TYPE}; charset=utf-8`, JSON.stringify(value));
}

function refuse(response: http.ServerResponse, status: Status, error: ReviewRefusal): void {
  sendJson(response, status, { error });
}

function progress(session: Session): { done: number; total: number } {
  return { done: session.tasks.filter((entry) => entry.done).length, total: session.tasks.length };
}

function mediaUrl(session: Session, media: ReviewMedia): string {
  return withToken(`${ReviewPath.MediaPrefix}${session.mediaIds.get(media) ?? ""}`, session.token);
}

/** The next open task's view, stamped as shown the first time it goes out. */
function nextView(session: Session): SessionView {
  const next = session.tasks.find((entry) => !entry.done) ?? null;
  if (next && next.shownAt === null) next.shownAt = session.now();
  const task = next ? taskView(next.task, next.id, (media) => mediaUrl(session, media)) : null;
  return { task, progress: progress(session), codes: SESSION_CODES };
}

function rowBase(session: Session, entry: SessionTask): ReviewRowBase {
  const now = session.now();
  const { task } = entry;
  return {
    campaignId: task.campaignId,
    caseId: task.caseId,
    caseVersion: task.caseVersion,
    reviewerId: session.options.reviewerId,
    placementSeed: task.placementSeed,
    recordedAt: new Date(now).toISOString(),
    reviewSeconds: entry.shownAt === null ? null : Math.round((now - entry.shownAt) / SECOND_MS),
  };
}

/** The row an answer makes for its task, or null when the answer does not fit the task's mode. */
function answerRow(session: Session, entry: SessionTask, answer: AnswerBody): ReviewRow | null {
  const { task } = entry;
  if (task.mode === ReviewMode.Pair) {
    if (answer.pick === null) return null;
    return pairReviewRow(rowBase(session, entry), {
      leftRunId: task.left.runId,
      rightRunId: task.right.runId,
      pick: answer.pick,
      defect: answer.defect,
      satisfied: answer.satisfied,
    });
  }
  if (answer.human === null) return null;
  return graderValidationRow(rowBase(session, entry), {
    runId: task.runId,
    itemId: task.item.id,
    verdicts: task.item.verdicts,
    human: answer.human,
    defect: answer.defect,
  });
}

/** The request body as text, or null when it outgrows the cap. */
function readBody(request: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_ANSWER_BYTES) {
        chunks.push(chunk);
        return;
      }
      // Stop reading; the refusal closes the connection instead of draining the rest.
      request.off("data", onData);
      request.pause();
      resolve(null);
    };
    request.on("data", onData);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function handleAnswer(session: Session, request: http.IncomingMessage, response: http.ServerResponse) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith(JSON_TYPE))
    return refuse(response, Status.UnsupportedMediaType, ReviewRefusal.NotJson);
  const text = await readBody(request);
  if (text === null) {
    response.setHeader("connection", "close");
    return refuse(response, Status.PayloadTooLarge, ReviewRefusal.TooLarge);
  }
  const answer = parseAnswer(parseJson(text));
  if (answer === null) return refuse(response, Status.BadRequest, ReviewRefusal.InvalidAnswer);
  const entry = session.tasks.find((candidate) => candidate.id === answer.taskId);
  if (!entry || entry.done || entry.saving) return refuse(response, Status.Conflict, ReviewRefusal.UnknownTask);
  const row = answerRow(session, entry, answer);
  if (row === null) return refuse(response, Status.BadRequest, ReviewRefusal.InvalidAnswer);
  entry.saving = true;
  try {
    await session.options.write(row);
  } catch {
    return refuse(response, Status.Unprocessable, ReviewRefusal.RowRefused);
  } finally {
    entry.saving = false;
  }
  entry.done = true;
  sendJson(response, Status.Ok, { saved: true, progress: progress(session) });
  if (session.tasks.every((candidate) => candidate.done)) session.onDone();
}

async function handleMedia(session: Session, id: string, response: http.ServerResponse) {
  const media = MEDIA_ID.test(id) ? session.media.get(id) : undefined;
  if (!media) return refuse(response, Status.NotFound, ReviewRefusal.NotFound);
  const servable = await readServableMedia(session.options.evidenceRoot, media);
  if (!servable) return refuse(response, Status.NotFound, ReviewRefusal.NotFound);
  send(response, Status.Ok, servable.contentType, servable.bytes);
}

/** A GET route's answer. */
async function handleGet(session: Session, pathname: string, response: http.ServerResponse) {
  if (pathname === ReviewPath.Page)
    return send(response, Status.Ok, "text/html; charset=utf-8", reviewPageHtml(session.token));
  if (pathname === ReviewPath.Script) return send(response, Status.Ok, "text/javascript; charset=utf-8", REVIEW_SCRIPT);
  if (pathname === ReviewPath.Style) return send(response, Status.Ok, "text/css; charset=utf-8", REVIEW_CSS);
  if (pathname === ReviewPath.Task) return sendJson(response, Status.Ok, nextView(session));
  if (pathname.startsWith(ReviewPath.MediaPrefix))
    return handleMedia(session, pathname.slice(ReviewPath.MediaPrefix.length), response);
  refuse(response, Status.NotFound, ReviewRefusal.NotFound);
}

/** Whether an answer's Origin, when the browser sent one, is this server. */
const sameOrigin = (request: http.IncomingMessage, origin: string) =>
  request.headers.origin === undefined || request.headers.origin === origin;

async function handle(session: Session, origin: string, request: http.IncomingMessage, response: http.ServerResponse) {
  if (request.headers.host !== new URL(origin).host)
    return refuse(response, Status.Forbidden, ReviewRefusal.ForeignHost);
  const url = new URL(request.url ?? "/", origin);
  if (!sameSecret(url.searchParams.get(TOKEN_PARAM) ?? "", session.token))
    return refuse(response, Status.Unauthorized, ReviewRefusal.BadToken);
  const isAnswer = url.pathname === ReviewPath.Answer;
  if (isAnswer && request.method === "POST") {
    if (!sameOrigin(request, origin)) return refuse(response, Status.Forbidden, ReviewRefusal.ForeignOrigin);
    return handleAnswer(session, request, response);
  }
  const readOnly = request.method === "GET" || request.method === "HEAD";
  if (!readOnly || isAnswer) return refuse(response, Status.MethodNotAllowed, ReviewRefusal.Method);
  return handleGet(session, url.pathname, response);
}

/** Every piece of media of every task, each under a fresh random id. */
function registerMedia(tasks: readonly ReviewTask[], randomHex: (bytes: number) => string): Map<string, ReviewMedia> {
  const media = new Map<string, ReviewMedia>();
  const sides = tasks.flatMap((task) => (task.mode === ReviewMode.Pair ? [task.left, task.right] : [task.side]));
  for (const side of sides)
    for (const item of [...side.frames, ...(side.video ? [side.video] : [])])
      media.set(randomHex(MEDIA_ID_BYTES), item);
  return media;
}

const defaultRandomHex = (bytes: number) => randomBytes(bytes).toString("hex");

/** Start one review session on a random loopback port. */
export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServerHandle> {
  const randomHex = options.randomHex ?? defaultRandomHex;
  const media = registerMedia(options.tasks, randomHex);
  let onDone = () => {};
  const finished = new Promise<void>((resolve) => {
    onDone = resolve;
  });
  const session: Session = {
    options,
    token: randomHex(REVIEW_TOKEN_BYTES),
    tasks: options.tasks.map((task) => ({
      id: randomHex(TASK_ID_BYTES),
      task,
      shownAt: null,
      saving: false,
      done: false,
    })),
    media,
    mediaIds: new Map([...media].map(([id, item]) => [item, id])),
    now: options.now ?? Date.now,
    onDone: () => onDone(),
  };
  if (!session.tasks.length) session.onDone();
  let origin = "";
  const server = http.createServer((request, response) => {
    handle(session, origin, request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else refuse(response, Status.NotFound, ReviewRefusal.NotFound);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, REVIEW_HOST, () => resolve());
  });
  origin = `http://${REVIEW_HOST}:${(server.address() as AddressInfo).port}`;
  return {
    url: `${origin}${withToken(ReviewPath.Page, session.token)}`,
    origin,
    progress: () => progress(session),
    finished,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
