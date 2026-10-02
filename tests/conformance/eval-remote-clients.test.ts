/**
 * The desktop-evals HTTP client (scripts/evals/remote/client.ts) against a scripted fetch: which
 * requests carry the ingest key and which carry nothing, retries only on 5xx of idempotent
 * routes, the 410 kill switch, timeouts, and the client-side bounds on origins, bodies and
 * presigned evidence uploads. A refused input sends nothing.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  ClientRefusal,
  createContributionClient,
  createIngestClient,
  evidenceAsk,
  isKillSwitch,
  MAX_RETRIES,
  RemoteError,
  RETRY_BASE_MS,
  runsOrigin,
  type Transport,
} from "../../scripts/evals/remote/client.ts";
import {
  COMMUNITY_EVAL_MAX_BYTES,
  CONTRIBUTION_MAX_BYTES,
  DEFAULT_RUNS_ORIGIN,
  DesktopEvalErrorCode,
  DesktopEvalStatus,
  EVIDENCE_MAX_FRAME_BYTES,
  EVIDENCE_MAX_OBJECTS_PER_RUN,
  EvidenceContentType,
  INSTALL_SECRET_HEADER,
  type PresignedUpload,
  RUNS_ORIGIN_ENV,
} from "../../scripts/evals/remote/contract.ts";
import type { IngestKey } from "../../scripts/evals/remote/key-file.ts";
import { NoteCode } from "../../scripts/evals/vocabulary.ts";
import { ContributionKind, RUN_SHARING_CONSENT_VERSION } from "../../src/shared/run-sharing.ts";
import { fakeFetch, hang, json } from "../fixtures/evals/remote-clients/fake-fetch.ts";
import { runIdFor, syntheticRow } from "../fixtures/evals/remote-clients/run-row.ts";

const ORIGIN = "https://runs.example.test";
const KEY_VALUE = "genex_sk_v1_FAKEfakeFAKEfake0123456789";
const KEY: IngestKey = Object.freeze({
  bearer: () => `Bearer ${KEY_VALUE}`,
  toString: () => "[redacted]",
  toJSON: () => "[redacted]",
});
const INSTALL_ID = "0123456789abcdef0123456789abcdef";
const INSTALL_SECRET = "fedcba9876543210fedcba9876543210";
const RUN_ID = runIdFor(1);
const NOW = Date.parse("2026-10-01T12:00:00Z");

function transportFor(answers: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(answers);
  const sleeps: number[] = [];
  const controllers: AbortController[] = [];
  const transport: Transport = {
    fetch: fake.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    timeout: () => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    },
    now: () => NOW,
  };
  return { ...fake, sleeps, controllers, transport };
}

const contribution = () => ({
  kind: ContributionKind.CommunityEval,
  installId: INSTALL_ID,
  consentVersion: RUN_SHARING_CONSENT_VERSION,
  row: syntheticRow(),
});

const frame = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const frameSha = createHash("sha256").update(frame).digest("hex");
const presigned = (patch: Partial<PresignedUpload> = {}): PresignedUpload => ({
  index: 0,
  url: "https://bucket.example.test/desktop/run/0.jpg?sig=FAKE",
  method: "PUT",
  headers: { "content-type": EvidenceContentType.Jpeg },
  expiresAt: "2026-10-01T12:05:00Z",
  ...patch,
});

async function refusal(promise: Promise<unknown>): Promise<RemoteError> {
  const error = await promise.then(
    () => assert.fail("expected a refusal"),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof RemoteError, String(error));
  return error;
}

/** Every operation, and whether its request carries the ingest key. */
const AUTH_MATRIX = [
  {
    name: "publish run",
    auth: true,
    answer: json(201, { runId: RUN_ID, created: true }),
    call: (t: Transport) =>
      createIngestClient({ origin: ORIGIN, key: KEY, transport: t }).publishRun({
        row: syntheticRow(),
        evalSha: "3434",
      }),
    path: "/api/evals/desktop/runs",
    method: "POST",
  },
  {
    name: "publish grade",
    auth: true,
    answer: json(200, { runId: RUN_ID, gradeSeq: 1, created: false }),
    call: (t: Transport) =>
      createIngestClient({ origin: ORIGIN, key: KEY, transport: t }).publishGrade(RUN_ID, {
        row: syntheticRow({ gradeSeq: 1 }),
      }),
    path: `/api/evals/desktop/runs/${RUN_ID}/grades`,
    method: "POST",
  },
  {
    name: "presign evidence",
    auth: true,
    answer: json(200, { uploads: [] }),
    call: (t: Transport) =>
      createIngestClient({ origin: ORIGIN, key: KEY, transport: t }).presignEvidence(RUN_ID, {
        objects: [evidenceAsk(0, EvidenceContentType.Jpeg, frame)],
      }),
    path: `/api/evals/desktop/runs/${RUN_ID}/evidence`,
    method: "POST",
  },
  {
    name: "presigned evidence PUT",
    auth: false,
    answer: new Response(null, { status: 200 }),
    call: (t: Transport) =>
      createIngestClient({ origin: ORIGIN, key: KEY, transport: t }).uploadEvidence(
        presigned(),
        evidenceAsk(0, EvidenceContentType.Jpeg, frame),
        frame,
      ),
    path: "/desktop/run/0.jpg",
    method: "PUT",
  },
  {
    name: "anonymous contribution",
    auth: false,
    answer: json(201, { accepted: true }),
    call: (t: Transport) =>
      createContributionClient({ origin: ORIGIN, transport: t }).contribute(contribution(), INSTALL_SECRET),
    path: "/api/desktop/contributions",
    method: "POST",
  },
  {
    name: "delete contributions",
    auth: false,
    answer: json(200, { installId: INSTALL_ID, deleted: 3 }),
    call: (t: Transport) =>
      createContributionClient({ origin: ORIGIN, transport: t }).deleteContributions(INSTALL_ID, INSTALL_SECRET),
    path: `/api/desktop/contributions/${INSTALL_ID}`,
    method: "DELETE",
  },
];
describe("which requests carry the ingest key (auth header matrix)", () => {
  for (const row of AUTH_MATRIX) {
    it(`${row.name}: ${row.auth ? "Bearer ingest key" : "no Authorization, no cookie"}`, async () => {
      const { transport, seen } = transportFor([row.answer]);
      await row.call(transport);
      assert.equal(seen.length, 1);
      const [request] = seen;
      assert.ok(request);
      assert.equal(new URL(request.url).pathname, row.path);
      assert.equal(request.method, row.method);
      assert.equal(request.headers.authorization, row.auth ? `Bearer ${KEY_VALUE}` : undefined);
      assert.equal(request.headers.cookie, undefined);
      assert.equal(request.credentials, "omit");
      assert.equal(request.redirect, "error", "a redirect never carries a header to another host");
      assert.equal(JSON.stringify(request.headers).includes(KEY_VALUE), row.auth);
    });
  }

  it("proves a delete with the install secret only", async () => {
    const { transport, seen } = transportFor([json(200, { installId: INSTALL_ID, deleted: 0 })]);
    const answer = await createContributionClient({ origin: ORIGIN, transport }).deleteContributions(
      INSTALL_ID,
      INSTALL_SECRET,
    );
    assert.deepEqual(answer, { installId: INSTALL_ID, deleted: 0 });
    assert.equal(seen[0]?.headers[INSTALL_SECRET_HEADER], INSTALL_SECRET);
    assert.equal(seen[0]?.body, null);
  });

  it("sends the run row and the eval sha, and reads back whether it was created", async () => {
    const { transport, seen } = transportFor([json(200, { runId: RUN_ID, created: false })]);
    const row = syntheticRow();
    const answer = await createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({ row, evalSha: "34" });
    assert.deepEqual(answer, { runId: RUN_ID, created: false });
    assert.deepEqual(JSON.parse(String(seen[0]?.body)), { row, evalSha: "34" });
    assert.equal(seen[0]?.headers["content-type"], "application/json");
  });
});

describe("retries: only 5xx, only idempotent routes, with doubling backoff", () => {
  it("retries a 5xx upsert and succeeds", async () => {
    const { transport, seen, sleeps } = transportFor([
      json(503, {}),
      json(502, {}),
      json(201, { runId: RUN_ID, created: true }),
    ]);
    const answer = await createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({
      row: syntheticRow(),
      evalSha: "34",
    });
    assert.equal(answer.created, true);
    assert.equal(seen.length, 3);
    assert.deepEqual(sleeps, [RETRY_BASE_MS, 2 * RETRY_BASE_MS]);
  });

  it("gives up after the last retry with the server's status", async () => {
    const { transport, seen } = transportFor(Array.from({ length: MAX_RETRIES + 2 }, () => json(500, {})));
    const error = await refusal(
      createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({ row: syntheticRow(), evalSha: "34" }),
    );
    assert.equal(error.status, 500);
    assert.equal(seen.length, MAX_RETRIES + 1);
  });

  it("never retries a 4xx, and reads its typed code", async () => {
    const { transport, seen, sleeps } = transportFor([json(400, { code: DesktopEvalErrorCode.InvalidRow })]);
    const error = await refusal(
      createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({ row: syntheticRow(), evalSha: "34" }),
    );
    assert.equal(error.code, DesktopEvalErrorCode.InvalidRow);
    assert.equal(seen.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("never retries a contribution, which is not idempotent", async () => {
    const { transport, seen } = transportFor([json(503, {}), json(201, { accepted: true })]);
    const error = await refusal(
      createContributionClient({ origin: ORIGIN, transport }).contribute(contribution(), INSTALL_SECRET),
    );
    assert.equal(error.status, 503);
    assert.equal(seen.length, 1);
  });

  it("surfaces a rate limit's retry-after without retrying", async () => {
    const { transport, seen } = transportFor([json(429, { code: DesktopEvalErrorCode.RateLimited, retryAfterS: 60 })]);
    const error = await refusal(
      createContributionClient({ origin: ORIGIN, transport }).contribute(contribution(), INSTALL_SECRET),
    );
    assert.equal(error.code, DesktopEvalErrorCode.RateLimited);
    assert.equal(error.retryAfterS, 60);
    assert.equal(seen.length, 1);
  });

  it("reads an unknown error body as a plain http failure, never as free text", async () => {
    const { transport } = transportFor([json(403, { code: "please-log-in-at-evil.example", detail: "x" })]);
    const error = await refusal(
      createContributionClient({ origin: ORIGIN, transport }).contribute(contribution(), INSTALL_SECRET),
    );
    assert.equal(error.code, ClientRefusal.Http);
    assert.equal(error.message.includes("evil"), false);
  });
});

describe("the 410 kill switch and timeouts", () => {
  it("a 410 says contributions are paused", async () => {
    const { transport } = transportFor([json(410, { code: DesktopEvalErrorCode.ContributionsPaused })]);
    const error = await refusal(
      createContributionClient({ origin: ORIGIN, transport }).contribute(contribution(), INSTALL_SECRET),
    );
    assert.equal(error.status, DesktopEvalStatus.Gone);
    assert.equal(isKillSwitch(error), true);
    assert.equal(isKillSwitch(new RemoteError(ClientRefusal.Http, 500)), false);
  });

  it("a hung request times out, once, without a retry", async () => {
    const { transport, seen, controllers } = transportFor([hang, json(200, { runId: RUN_ID, created: true })]);
    const pending = createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({
      row: syntheticRow(),
      evalSha: "34",
    });
    await Promise.resolve();
    await Promise.resolve();
    controllers[0]?.abort(new DOMException("timed out", "TimeoutError"));
    const error = await refusal(pending);
    assert.equal(error.code, ClientRefusal.Timeout);
    assert.equal(seen.length, 1);
  });

  it("a network failure is typed and carries no request detail", async () => {
    const transport: Transport = {
      ...transportFor([]).transport,
      fetch: async () => {
        throw new TypeError(`fetch failed ${KEY_VALUE}`);
      },
    };
    const error = await refusal(
      createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({ row: syntheticRow(), evalSha: "34" }),
    );
    assert.equal(error.code, ClientRefusal.Network);
    assert.equal(error.message.includes(KEY_VALUE), false);
  });

  it("an oversized or malformed success body is a bad response", async () => {
    for (const answer of [
      new Response("x".repeat(70_000), { status: 200 }),
      new Response("not json", { status: 200 }),
      json(200, { runId: 42 }),
    ]) {
      const { transport } = transportFor([answer]);
      const error = await refusal(
        createIngestClient({ origin: ORIGIN, key: KEY, transport }).publishRun({ row: syntheticRow(), evalSha: "34" }),
      );
      assert.equal(error.code, ClientRefusal.BadResponse);
    }
  });
});

describe("hostile inputs are refused before anything is sent", () => {
  it("runs origin: the default, removed, and only https or loopback http", () => {
    assert.equal(runsOrigin({}), DEFAULT_RUNS_ORIGIN);
    assert.equal(runsOrigin({ [RUNS_ORIGIN_ENV]: "" }), null);
    assert.equal(runsOrigin({ [RUNS_ORIGIN_ENV]: "https://runs.example.test/" }), "https://runs.example.test");
    assert.equal(runsOrigin({ [RUNS_ORIGIN_ENV]: "http://127.0.0.1:8787" }), "http://127.0.0.1:8787");
    for (const hostile of [
      "http://runs.example.test",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pw@runs.example.test",
      "https://runs.example.test/prefix",
      "https://runs.example.test/?q=1",
      "not a url",
      "ftp://runs.example.test",
    ]) {
      assert.throws(
        () => runsOrigin({ [RUNS_ORIGIN_ENV]: hostile }),
        (error: unknown) => error instanceof RemoteError && error.code === ClientRefusal.OriginInvalid,
        hostile,
      );
    }
  });

  it("a community eval row up to its kind's 32 KiB is sent; a larger one never is", async () => {
    const withNotes = (count: number) => ({
      ...contribution(),
      row: syntheticRow({ notes: Array.from({ length: count }, () => NoteCode.CoRun) }),
    });
    const rich = withNotes(800);
    assert.ok(Buffer.byteLength(JSON.stringify(rich)) > CONTRIBUTION_MAX_BYTES, "over the field row's cap");
    const sent = transportFor([json(201, { accepted: true })]);
    await createContributionClient({ origin: ORIGIN, transport: sent.transport }).contribute(rich, INSTALL_SECRET);
    assert.equal(sent.seen.length, 1);

    const { transport, seen } = transportFor([json(201, { accepted: true })]);
    const big = withNotes(4000);
    assert.ok(Buffer.byteLength(JSON.stringify(big)) > COMMUNITY_EVAL_MAX_BYTES);
    const error = await refusal(
      createContributionClient({ origin: ORIGIN, transport }).contribute(big, INSTALL_SECRET),
    );
    assert.equal(error.code, ClientRefusal.BodyTooLarge);
    assert.equal(seen.length, 0);
  });

  it("proves a contribution with the install secret, and never sends one without a well-formed secret", async () => {
    const { transport, seen } = transportFor([json(201, { accepted: true })]);
    await createContributionClient({ origin: ORIGIN, transport }).contribute(contribution(), INSTALL_SECRET);
    assert.equal(seen[0]?.headers[INSTALL_SECRET_HEADER], INSTALL_SECRET);
    for (const secret of ["", "short", `${INSTALL_SECRET}\r\nx-evil: 1`, INSTALL_SECRET.toUpperCase()]) {
      const refused = transportFor([json(201, { accepted: true })]);
      const error = await refusal(
        createContributionClient({ origin: ORIGIN, transport: refused.transport }).contribute(contribution(), secret),
      );
      assert.equal(error.code, ClientRefusal.InvalidInput, JSON.stringify(secret));
      assert.equal(refused.seen.length, 0);
    }
  });

  it("a delete with a malformed install id or secret is never sent", async () => {
    for (const [installId, secret] of [
      ["../../admin", INSTALL_SECRET],
      [INSTALL_ID.toUpperCase(), INSTALL_SECRET],
      [INSTALL_ID, "short"],
      [INSTALL_ID, `${INSTALL_SECRET}\r\nx-evil: 1`],
    ] as const) {
      const { transport, seen } = transportFor([json(200, { installId, deleted: 0 })]);
      const error = await refusal(
        createContributionClient({ origin: ORIGIN, transport }).deleteContributions(installId, secret),
      );
      assert.equal(error.code, ClientRefusal.InvalidInput, installId);
      assert.equal(seen.length, 0);
    }
  });
});

describe("hostile evidence asks and presigned uploads are refused before anything is sent", () => {
  it("a presign ask out of bounds is never sent", async () => {
    const ask = evidenceAsk(0, EvidenceContentType.Jpeg, frame);
    const table = [
      {
        name: "too many objects",
        objects: Array.from({ length: EVIDENCE_MAX_OBJECTS_PER_RUN + 1 }, (_, i) => ({ ...ask, index: i })),
      },
      { name: "no objects", objects: [] },
      { name: "wrong type", objects: [{ ...ask, contentType: "text/html" as EvidenceContentType }] },
      { name: "frame too big", objects: [{ ...ask, bytes: EVIDENCE_MAX_FRAME_BYTES + 1 }] },
      { name: "empty", objects: [{ ...ask, bytes: 0 }] },
      { name: "bad digest", objects: [{ ...ask, sha256: "abc" }] },
      { name: "duplicate index", objects: [ask, ask] },
      { name: "negative index", objects: [{ ...ask, index: -1 }] },
    ];
    for (const row of table) {
      const { transport, seen } = transportFor([json(200, { uploads: [] })]);
      const error = await refusal(
        createIngestClient({ origin: ORIGIN, key: KEY, transport }).presignEvidence(RUN_ID, { objects: row.objects }),
      );
      assert.equal(error.code, ClientRefusal.EvidenceInvalid, row.name);
      assert.equal(seen.length, 0, row.name);
    }
  });

  it("a presigned upload the server got wrong (or a hostile one) is never sent", async () => {
    const ask = evidenceAsk(0, EvidenceContentType.Jpeg, frame);
    assert.equal(ask.sha256, frameSha);
    const table = [
      { name: "plain http", upload: presigned({ url: "http://bucket.example.test/x" }) },
      { name: "file url", upload: presigned({ url: "file:///tmp/x" }) },
      { name: "credentials in url", upload: presigned({ url: "https://a:b@bucket.example.test/x" }) },
      { name: "other index", upload: presigned({ index: 1 }) },
      { name: "not a PUT", upload: { ...presigned(), method: "POST" as "PUT" } },
      { name: "asks for authorization", upload: presigned({ headers: { authorization: "Bearer x" } }) },
      { name: "asks for a cookie", upload: presigned({ headers: { Cookie: "a=b" } }) },
      { name: "asks for the install secret", upload: presigned({ headers: { [INSTALL_SECRET_HEADER]: "x" } }) },
      { name: "other content type", upload: presigned({ headers: { "content-type": "text/html" } }) },
      { name: "expired", upload: presigned({ expiresAt: "2026-10-01T11:59:59Z" }) },
      { name: "no expiry", upload: presigned({ expiresAt: "soon" }) },
    ];
    for (const row of table) {
      const { transport, seen } = transportFor([new Response(null, { status: 200 })]);
      const error = await refusal(
        createIngestClient({ origin: ORIGIN, key: KEY, transport }).uploadEvidence(row.upload, ask, frame),
      );
      assert.equal(error.code, ClientRefusal.UploadInvalid, row.name);
      assert.equal(seen.length, 0, row.name);
    }
  });

  it("bytes that do not match their ask are never uploaded", async () => {
    const ask = evidenceAsk(0, EvidenceContentType.Jpeg, frame);
    for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(frame.length)]) {
      const { transport, seen } = transportFor([new Response(null, { status: 200 })]);
      const error = await refusal(
        createIngestClient({ origin: ORIGIN, key: KEY, transport }).uploadEvidence(presigned(), ask, bytes),
      );
      assert.equal(error.code, ClientRefusal.UploadInvalid);
      assert.equal(seen.length, 0);
    }
  });

  it("uploads exactly the presigned headers and the bytes", async () => {
    const { transport, seen } = transportFor([new Response(null, { status: 200 })]);
    await createIngestClient({ origin: ORIGIN, key: KEY, transport }).uploadEvidence(
      presigned({ headers: { "Content-Type": EvidenceContentType.Jpeg, "x-amz-meta-run": "fixture" } }),
      evidenceAsk(0, EvidenceContentType.Jpeg, frame),
      frame,
    );
    assert.deepEqual(seen[0]?.headers, { "content-type": EvidenceContentType.Jpeg, "x-amz-meta-run": "fixture" });
    assert.deepEqual(seen[0]?.body, frame);
  });
});
