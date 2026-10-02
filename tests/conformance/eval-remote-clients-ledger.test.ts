/**
 * `ledger publish`, `ledger share` and `ledger unshare` (scripts/evals/remote/{publish,share}.ts)
 * against a scripted fetch and temp eval homes: publish sends each run's current grade as the run
 * upsert and then every grade as a grade upsert, with the key file's key and no other credential;
 * `--publish-evidence` uploads only safe evidence files; share sends public rows only, after
 * printing them and a yes, anonymously, and never sends a row it already shared; unshare deletes
 * the rows of every identity this machine kept. Every refusal sends nothing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { describe, it, mock } from "node:test";
import type { RunRow } from "../../scripts/evals/ledger/types.ts";
import type { Transport } from "../../scripts/evals/remote/client.ts";
import {
  CONTRIBUTION_DAILY_CAP_PER_INSTALL,
  DesktopEvalErrorCode,
  EVALS_KEY_FILE_ENV,
  INSTALL_SECRET_HEADER,
  RUNS_ORIGIN_ENV,
} from "../../scripts/evals/remote/contract.ts";
import { EVALS_HOME_ENV } from "../../scripts/evals/home.ts";
import { KeyFileError } from "../../scripts/evals/remote/key-file.ts";
import {
  defaultPublishDeps,
  evidenceLister,
  ledgerPublishCommand,
  type PublishDeps,
  publishCampaign,
  type RowGuard,
} from "../../scripts/evals/remote/publish.ts";
import {
  ledgerShareCommand,
  ledgerUnshareCommand,
  type ShareDeps,
  ShareLine,
  shareCampaign,
  type UnshareDeps,
  UnshareLine,
} from "../../scripts/evals/remote/share.ts";
import {
  evalInstallIdentity,
  INSTALL_IDENTITY_SEGMENTS,
  readInstallIdentities,
  SHARED_RECORD_SEGMENTS,
  shareRecord,
} from "../../scripts/evals/remote/share-record.ts";
import { CampaignVoidReason, CaseVisibility } from "../../scripts/evals/vocabulary.ts";
import { ContributionKind, INSTALL_ID_PATTERN, RUN_SHARING_CONSENT_VERSION } from "../../src/shared/run-sharing.ts";
import { fakeFetch, json } from "../fixtures/evals/remote-clients/fake-fetch.ts";
import { CAMPAIGN, runIdFor, syntheticRow } from "../fixtures/evals/remote-clients/run-row.ts";
import { tmpDir } from "../helpers/tmp.ts";

const ORIGIN = "https://runs.example.test";
const KEY_BODY = "FAKEfakeFAKEfake0123456789";
const KEY = `genex_sk_v1_${KEY_BODY}`;
const NOW = Date.parse("2026-10-01T12:00:00Z");
const ACCEPT_ALL: RowGuard = () => ({ ok: true });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const DAY = 24 * 3600 * 1000;

function fakeTransport(answers: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(answers);
  const transport: Transport = {
    fetch: fake.fetch,
    sleep: async () => {},
    timeout: () => new AbortController().signal,
    now: () => NOW,
  };
  return { ...fake, transport };
}

/** An eval home outside Git with a private key file. */
async function evalHome(): Promise<string> {
  const home = await tmpDir("eval-home-");
  await fsp.mkdir(path.join(home, "secrets"), { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(home, "secrets", "genex-evals.key"), `${KEY}\n`, { mode: 0o600 });
  return home;
}

function publishDeps(home: string, rows: readonly RunRow[], answers: Parameters<typeof fakeFetch>[0]) {
  const lines: string[] = [];
  const fake = fakeTransport(answers);
  const env = { [EVALS_HOME_ENV]: home, [RUNS_ORIGIN_ENV]: ORIGIN };
  const deps: PublishDeps = {
    ...defaultPublishDeps(env),
    readAllGrades: async () => rows,
    guard: ACCEPT_ALL,
    transport: fake.transport,
    out: (line) => lines.push(line),
  };
  return { deps, lines, ...fake };
}

const runAnswer = (rep: number, created = true) => json(created ? 201 : 200, { runId: runIdFor(rep), created });
const gradeAnswer = (rep: number, gradeSeq: number) => json(200, { runId: runIdFor(rep), gradeSeq, created: true });
const bodyOf = (request: { body: unknown } | undefined) => JSON.parse(String(request?.body));

describe("ledger publish", () => {
  it("upserts each run's current grade as the run row, then every grade, with the key file's key", async () => {
    const home = await evalHome();
    const rows = [
      syntheticRow({ runId: runIdFor(1), gradeSeq: 1 }),
      syntheticRow({ runId: runIdFor(1), gradeSeq: 0 }),
      syntheticRow({ runId: runIdFor(2), gradeSeq: 0 }),
    ];
    const { deps, seen, lines } = publishDeps(home, rows, [
      runAnswer(1),
      gradeAnswer(1, 0),
      gradeAnswer(1, 1),
      runAnswer(2, false),
      gradeAnswer(2, 0),
    ]);
    assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: false }, deps), 0);
    const grades = (rep: number) => `/api/evals/desktop/runs/${runIdFor(rep)}/grades`;
    assert.deepEqual(
      seen.map((request) => new URL(request.url).pathname),
      ["/api/evals/desktop/runs", grades(1), grades(1), "/api/evals/desktop/runs", grades(2)],
    );
    assert.equal(bodyOf(seen[0]).evalSha, rows[0]?.pins.recorded.evalSha);
    assert.equal(bodyOf(seen[0]).row.gradeSeq, 1, "the run row is the current grade");
    assert.deepEqual(
      seen.slice(1, 3).map((request) => bodyOf(request).row.gradeSeq),
      [0, 1],
    );
    for (const request of seen) assert.equal(request.headers.authorization, `Bearer ${KEY}`);
    assert.equal(lines.join("\n").includes(KEY_BODY), false, "the key is never printed");
  });

  it("carries a later grade's time and void on the run row, whatever order the ledger holds them in", async () => {
    const home = await evalHome();
    const collected = syntheticRow({ gradeSeq: 1 });
    const graded = syntheticRow({ gradeSeq: 2, time: { ...collected.time, firstBootMs: 4200, firstPlayableMs: 8400 } });
    const voided = syntheticRow({ ...graded, gradeSeq: 3, campaignVoid: CampaignVoidReason.ClosingCanary });
    const { deps, seen } = publishDeps(
      home,
      [voided, collected, graded],
      [runAnswer(1), gradeAnswer(1, 1), gradeAnswer(1, 2), gradeAnswer(1, 3)],
    );
    assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: false }, deps), 0);
    const run = bodyOf(seen[0]).row;
    assert.equal(run.gradeSeq, 3);
    assert.equal(run.campaignVoid, CampaignVoidReason.ClosingCanary);
    assert.equal(run.time.firstPlayableMs, 8400);
    assert.equal(run.time.firstBootMs, 4200);
    assert.deepEqual(
      seen.slice(1).map((request) => bodyOf(request).row.gradeSeq),
      [1, 2, 3],
      "the whole grade history still goes up, oldest first",
    );
  });

  it("refuses the whole campaign before reading the key or sending, when any row fails a check", async () => {
    const home = await evalHome();
    const good = syntheticRow();
    const table: Array<{ name: string; rows: RunRow[]; guard?: RowGuard }> = [
      { name: "no rows", rows: [] },
      { name: "another campaign's row", rows: [good, syntheticRow({ campaignId: "20261001T120000-other" })] },
      { name: "a malformed run id", rows: [syntheticRow({ runId: "../../etc" })] },
      { name: "the guard refuses", rows: [good], guard: () => ({ ok: false, reason: "free-text" }) },
      {
        name: "a credential inside a row",
        rows: [syntheticRow({ gradeId: `x ${KEY}` })],
      },
    ];
    for (const row of table) {
      let keyRead = false;
      const { deps, seen } = publishDeps(home, row.rows, [runAnswer(1)]);
      const exit = await publishCampaign(
        CAMPAIGN,
        { publishEvidence: false },
        {
          ...deps,
          guard: row.guard ?? ACCEPT_ALL,
          readKey: async (env) => {
            keyRead = true;
            return deps.readKey(env);
          },
        },
      );
      assert.equal(exit, 1, row.name);
      assert.equal(seen.length, 0, row.name);
      assert.equal(keyRead, false, row.name);
    }
  });

  it("refuses a bad campaign id, a removed origin and a refused key file without sending", async () => {
    const home = await evalHome();
    const { deps, seen, lines } = publishDeps(home, [syntheticRow()], [runAnswer(1)]);
    assert.equal(await ledgerPublishCommand(deps)(["../etc"]), 64);
    assert.equal(await ledgerPublishCommand(deps)([]), 64);
    assert.equal(await ledgerPublishCommand(deps)([CAMPAIGN, "--bogus"]), 64);
    assert.equal(
      await publishCampaign(CAMPAIGN, { publishEvidence: false }, { ...deps, env: { [RUNS_ORIGIN_ENV]: "" } }),
      1,
    );
    await fsp.chmod(path.join(home, "secrets", "genex-evals.key"), 0o644);
    assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: false }, deps), 1);
    assert.equal(seen.length, 0);
    assert.equal(lines.join("\n").includes(KEY_BODY), false);
  });

  it("stops at the first failure and says which code", async () => {
    const home = await evalHome();
    const rows = [syntheticRow({ runId: runIdFor(1) }), syntheticRow({ runId: runIdFor(2) })];
    const { deps, seen, lines } = publishDeps(home, rows, [json(401, { code: DesktopEvalErrorCode.Unauthorized })]);
    assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: false }, deps), 1);
    assert.equal(seen.length, 1);
    assert.ok(lines.some((line) => line.includes(DesktopEvalErrorCode.Unauthorized)));
  });
});

/** Record every file the process opens for reading, through `node:fs` and `node:fs/promises`. */
function spyOnFileReads() {
  const touched: string[] = [];
  const record = (name: string, target: unknown) => touched.push(`${name}:${String(target)}`);
  const original = { readFile: fsp.readFile, readFileSync: fs.readFileSync, open: fsp.open };
  const spies = [
    mock.method(fsp, "readFile", (...args: Parameters<typeof fsp.readFile>) => {
      record("readFile", args[0]);
      return original.readFile(...args);
    }),
    mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
      record("readFileSync", args[0]);
      return original.readFileSync(...args);
    }),
    mock.method(fsp, "open", (...args: Parameters<typeof fsp.open>) => {
      record("open", args[0]);
      return original.open(...args);
    }),
  ];
  syncBuiltinESMExports();
  return {
    touched,
    restore: () => {
      for (const spy of spies) spy.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

describe("ledger publish: evidence", () => {
  it("--publish-evidence uploads only regular evidence files inside the run's folder", async () => {
    const home = await evalHome();
    const runId = runIdFor(1);
    const dir = path.join(home, "evidence", runId);
    await fsp.mkdir(path.join(dir, "frames"), { recursive: true });
    await fsp.writeFile(path.join(dir, "frames", "0001.jpg"), JPEG);
    await fsp.writeFile(path.join(dir, "notes.html"), "<p>not evidence</p>");
    const outside = await tmpDir("eval-outside-");
    await fsp.writeFile(path.join(outside, "secret.jpg"), JPEG);
    await fsp.symlink(path.join(outside, "secret.jpg"), path.join(dir, "frames", "0002.jpg"));
    const upload = {
      index: 0,
      url: "https://bucket.example.test/desktop/run/0.jpg?sig=FAKE",
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      expiresAt: "2026-10-01T12:05:00Z",
    };
    const { deps, seen } = publishDeps(
      home,
      [syntheticRow({ runId })],
      [runAnswer(1), gradeAnswer(1, 0), json(200, { uploads: [upload] }), new Response(null, { status: 200 })],
    );
    assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: true }, deps), 0);
    assert.equal(seen.length, 4);
    const presign = JSON.parse(String(seen[2]?.body));
    assert.equal(presign.objects.length, 1, "the symlink and the html file are not evidence");
    assert.equal(presign.objects[0].contentType, "image/jpeg");
    assert.equal(seen[3]?.method, "PUT");
    assert.equal(seen[3]?.headers.authorization, undefined);
    assert.deepEqual(new Uint8Array(seen[3]?.body as Uint8Array), JPEG);
  });

  it("lists the prober's PNG frames as image/png evidence", async () => {
    const home = await evalHome();
    const dir = path.join(home, "evidence", runIdFor(1), "frames");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "0001.png"), PNG);
    await fsp.writeFile(path.join(dir, "0002.jpg"), JPEG);
    const objects = await evidenceLister(home)(runIdFor(1));
    assert.deepEqual(
      objects.map((object) => [path.basename(object.file), object.contentType]),
      [
        ["0001.png", "image/png"],
        ["0002.jpg", "image/jpeg"],
      ],
    );
  });

  it("the evidence lister refuses a traversal run id and a run folder linked outside the home", async () => {
    const home = await evalHome();
    const outside = await tmpDir("eval-outside-");
    await fsp.writeFile(path.join(outside, "a.jpg"), JPEG);
    await fsp.mkdir(path.join(home, "evidence"), { recursive: true });
    await fsp.symlink(outside, path.join(home, "evidence", runIdFor(3)));
    const list = evidenceLister(home);
    assert.deepEqual(await list("../../outside"), []);
    assert.deepEqual(await list(runIdFor(3)), []);
    assert.deepEqual(await list(runIdFor(4)), [], "no folder, no evidence");
  });
});

describe("ledger publish: the key file is the only credential", () => {
  it("reads no credential but the key file: no other file, no other variable", async () => {
    const home = await evalHome();
    const decoyHome = await tmpDir("eval-decoy-");
    await fsp.mkdir(path.join(decoyHome, ".genex"), { recursive: true });
    await fsp.writeFile(
      path.join(decoyHome, ".genex", "credentials.json"),
      '{"token":"genex_sk_v1_DECOYdecoyDECOYdecoy01"}',
    );
    const files = spyOnFileReads();
    const lines: string[] = [];
    const read = new Set<string>();
    const env = new Proxy(
      {
        [EVALS_HOME_ENV]: home,
        [RUNS_ORIGIN_ENV]: ORIGIN,
        HOME: decoyHome,
        GENEX_TOKEN: "genex_sk_v1_DECOYdecoyDECOYdecoy02",
        GENEX_API_KEY: "genex_sk_v1_DECOYdecoyDECOYdecoy03",
      } as Record<string, string | undefined>,
      {
        get: (target, name) => {
          if (typeof name === "string") read.add(name);
          return target[name as string];
        },
      },
    );
    try {
      const fake = fakeTransport([runAnswer(1), gradeAnswer(1, 0)]);
      const deps: PublishDeps = {
        ...defaultPublishDeps(env),
        readAllGrades: async () => [syntheticRow()],
        guard: ACCEPT_ALL,
        transport: fake.transport,
        out: (line) => lines.push(line),
      };
      assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: false }, deps), 0, lines.join("\n"));
      assert.equal(fake.seen[0]?.headers.authorization, `Bearer ${KEY}`);
    } finally {
      files.restore();
    }
    const keyFile = path.join(home, "secrets", "genex-evals.key");
    const realKey = await fsp.realpath(keyFile);
    assert.deepEqual(
      files.touched.filter((entry) => !entry.endsWith(keyFile) && !entry.endsWith(realKey)),
      [],
      "only the key file is read",
    );
    assert.ok(files.touched.length > 0, "vacuity: the spy saw the key file read");
    assert.deepEqual(
      [...read].filter((name) => ![EVALS_HOME_ENV, EVALS_KEY_FILE_ENV, RUNS_ORIGIN_ENV].includes(name)),
      [],
      "only the eval home, key file and origin variables are read",
    );
  });

  it("a key file refusal reaches the operator as a code, never the key", async () => {
    const home = await evalHome();
    await fsp.writeFile(path.join(home, "secrets", "genex-evals.key"), `${KEY} extra`, { mode: 0o600 });
    const { deps, lines } = publishDeps(home, [syntheticRow()], []);
    assert.equal(await publishCampaign(CAMPAIGN, { publishEvidence: false }, deps), 1);
    assert.ok(lines.some((line) => line.includes("bad-shape")));
    assert.equal(lines.join("\n").includes(KEY_BODY), false);
    await assert.rejects(deps.readKey(deps.env), KeyFileError);
  });
});

function shareDeps(home: string, rows: readonly RunRow[], answers: Parameters<typeof fakeFetch>[0], confirm = true) {
  const lines: string[] = [];
  const questions: string[] = [];
  const fake = fakeTransport(answers);
  const deps: ShareDeps = {
    env: { [EVALS_HOME_ENV]: home, [RUNS_ORIGIN_ENV]: ORIGIN },
    readCurrentRows: async () => rows,
    guard: ACCEPT_ALL,
    confirm: async (question) => {
      questions.push(question);
      return confirm;
    },
    identity: () => evalInstallIdentity(home, () => NOW),
    record: shareRecord(home),
    transport: fake.transport,
    out: (line) => lines.push(line),
  };
  return { deps, lines, questions, ...fake };
}

const identityFile = (home: string) => path.join(home, ...INSTALL_IDENTITY_SEGMENTS);

describe("ledger share", () => {
  it("prints the exact public rows, asks, then sends them anonymously; holdouts are withheld", async () => {
    const home = await evalHome();
    const publicRow = syntheticRow({ runId: runIdFor(1) });
    const holdout = syntheticRow({
      runId: runIdFor(2, "holdout-case"),
      case: { ...publicRow.case, id: "holdout-case", visibility: CaseVisibility.Holdout },
    });
    const { deps, seen, lines, questions } = shareDeps(home, [publicRow, holdout], [json(201, { accepted: true })]);
    assert.equal(await shareCampaign(CAMPAIGN, { yes: false }, deps), 0);
    assert.equal(questions.length, 1);
    assert.ok(lines.includes(JSON.stringify(publicRow)), "the exact row is printed");
    assert.equal(
      lines.some((line) => line.includes("holdout-case")),
      false,
      "a holdout row is never printed",
    );
    assert.equal(seen.length, 1);
    const [request] = seen;
    assert.equal(request?.headers.authorization, undefined);
    assert.equal(request?.headers.cookie, undefined);
    const body = JSON.parse(String(request?.body));
    assert.equal(body.kind, ContributionKind.CommunityEval);
    assert.equal(body.consentVersion, RUN_SHARING_CONSENT_VERSION);
    assert.match(body.installId, INSTALL_ID_PATTERN);
    assert.deepEqual(body.row, publicRow);
  });

  it("--yes skips the question for this campaign only", async () => {
    const home = await evalHome();
    const { deps, questions, seen } = shareDeps(home, [syntheticRow()], [json(201, { accepted: true })]);
    assert.equal(await ledgerShareCommand(deps)([CAMPAIGN, "--yes"]), 0);
    assert.equal(questions.length, 0);
    assert.equal(seen.length, 1);
  });

  it("a no sends nothing and mints no install identity", async () => {
    const home = await evalHome();
    const { deps, seen } = shareDeps(home, [syntheticRow()], [json(201, { accepted: true })], false);
    assert.equal(await shareCampaign(CAMPAIGN, { yes: false }, deps), 1);
    assert.equal(seen.length, 0);
    await assert.rejects(fsp.stat(identityFile(home)));
  });

  it("refuses before asking when nothing public is left, a row fails a check, or sharing is removed", async () => {
    const home = await evalHome();
    const holdout = syntheticRow({ case: { ...syntheticRow().case, visibility: CaseVisibility.Holdout } });
    const table: Array<{ name: string; rows: RunRow[]; guard?: RowGuard; env?: Record<string, string> }> = [
      { name: "holdouts only", rows: [holdout] },
      { name: "no rows", rows: [] },
      { name: "guard refuses", rows: [syntheticRow()], guard: () => ({ ok: false, reason: "path" }) },
      { name: "credential in a row", rows: [syntheticRow({ gradeId: KEY })] },
      { name: "another campaign", rows: [syntheticRow({ campaignId: "20261001T120000-other" })] },
      { name: "sharing removed", rows: [syntheticRow()], env: { [RUNS_ORIGIN_ENV]: "" } },
    ];
    for (const row of table) {
      const { deps, seen, questions } = shareDeps(home, row.rows, [json(201, { accepted: true })]);
      const exit = await shareCampaign(
        CAMPAIGN,
        { yes: false },
        { ...deps, guard: row.guard ?? ACCEPT_ALL, env: row.env ?? deps.env },
      );
      assert.equal(exit, 1, row.name);
      assert.equal(questions.length, 0, row.name);
      assert.equal(seen.length, 0, row.name);
    }
    await assert.rejects(fsp.stat(identityFile(home)), "no identity minted by a refusal");
  });

  it("stops on the kill switch and on a rate limit", async () => {
    for (const [answer, code] of [
      [json(410, { code: DesktopEvalErrorCode.ContributionsPaused }), DesktopEvalErrorCode.ContributionsPaused],
      [json(429, { code: DesktopEvalErrorCode.RateLimited, retryAfterS: 30 }), DesktopEvalErrorCode.RateLimited],
    ] as const) {
      const home = await evalHome();
      const rows = [syntheticRow({ runId: runIdFor(1) }), syntheticRow({ runId: runIdFor(2) })];
      const { deps, seen, lines } = shareDeps(home, rows, [answer, json(201, { accepted: true })]);
      assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, deps), 1);
      assert.equal(seen.length, 1, code);
      assert.ok(
        lines.some((line) => line.includes(code)),
        code,
      );
    }
  });

  it("usage errors exit 64 and send nothing", async () => {
    const home = await evalHome();
    const { deps, seen } = shareDeps(home, [syntheticRow()], []);
    for (const args of [[], ["not-a-campaign"], [CAMPAIGN, "--force"]])
      assert.equal(await ledgerShareCommand(deps)(args), 64);
    assert.equal(seen.length, 0);
  });
});

const accepted = () => json(201, { accepted: true });
const manyRows = (count: number) => Array.from({ length: count }, (_, i) => syntheticRow({ runId: runIdFor(i + 1) }));

describe("ledger share: resuming", () => {
  it("never re-sends a row the server accepted, after a rate limit or a failure", async () => {
    for (const stop of [json(429, { code: DesktopEvalErrorCode.RateLimited, retryAfterS: 60 }), json(503, {})]) {
      const home = await evalHome();
      const rows = manyRows(15);
      const first = shareDeps(home, rows, [...Array.from({ length: 10 }, accepted), stop]);
      assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, first.deps), 1);
      assert.equal(first.seen.length, 11);
      const second = shareDeps(home, rows, Array.from({ length: 15 }, accepted));
      assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, second.deps), 0);
      assert.deepEqual(
        second.seen.map((request) => bodyOf(request).row.runId),
        rows.slice(10).map((row) => row.runId),
        "only the rows the server never accepted",
      );
      assert.ok(second.lines.includes(`${ShareLine.AlreadyShared} 10`), second.lines.join("\n"));
      const third = shareDeps(home, rows, [accepted()]);
      assert.equal(await shareCampaign(CAMPAIGN, { yes: false }, third.deps), 0);
      assert.equal(third.seen.length, 0);
      assert.equal(third.questions.length, 0, "nothing left to ask about");
      assert.ok(third.lines.includes(`${ShareLine.AlreadyShared} 15`));
    }
  });

  it("shares a regraded run's new grade, and skips a row shared under a retired identity", async () => {
    const home = await evalHome();
    const row = syntheticRow({ gradeSeq: 2 });
    assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, shareDeps(home, [row], [accepted()]).deps), 0);
    const rotated = shareDeps(home, [row], [accepted()]);
    rotated.deps.identity = () => evalInstallIdentity(home, () => NOW + 91 * DAY);
    assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, rotated.deps), 0);
    assert.equal(rotated.seen.length, 0, "already shared under the old identity");
    const regraded = shareDeps(home, [{ ...row, gradeSeq: 3 }], [accepted()]);
    assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, regraded.deps), 0);
    assert.equal(regraded.seen.length, 1);
  });

  it("sends at most the daily cap and leaves the rest for a later run", async () => {
    const home = await evalHome();
    const rows = manyRows(CONTRIBUTION_DAILY_CAP_PER_INSTALL + 5);
    const { deps, seen, lines, questions } = shareDeps(home, rows, Array.from({ length: rows.length }, accepted));
    assert.equal(await shareCampaign(CAMPAIGN, { yes: false }, deps), 0);
    assert.equal(seen.length, CONTRIBUTION_DAILY_CAP_PER_INSTALL);
    assert.ok(lines.includes(`${ShareLine.Deferred} 5`), lines.join("\n"));
    assert.match(questions[0] ?? "", new RegExp(`Share these ${CONTRIBUTION_DAILY_CAP_PER_INSTALL} rows`));
    assert.equal(
      lines.some((line) => line.includes(rows.at(-1)?.runId ?? "?")),
      false,
      "a deferred row is not previewed",
    );
  });

  it("stops on a malformed record or identity file, sending nothing", async () => {
    for (const segments of [SHARED_RECORD_SEGMENTS, INSTALL_IDENTITY_SEGMENTS]) {
      const home = await evalHome();
      await fsp.writeFile(path.join(home, ...segments), "{not json\n", { mode: 0o600 });
      const { deps, seen, lines } = shareDeps(home, [syntheticRow()], [accepted()]);
      assert.equal(await shareCampaign(CAMPAIGN, { yes: true }, deps), 1, segments.join("/"));
      assert.equal(seen.length, 0, segments.join("/"));
      assert.ok(
        lines.some((line) => line.startsWith(ShareLine.Stopped) || line.startsWith(ShareLine.Refused)),
        lines.join("\n"),
      );
    }
  });
});

const hex = (digit: string) => digit.repeat(32);
const CURRENT = { installId: hex("a"), secret: hex("b") };
const RETIRED = { installId: hex("c"), secret: hex("d") };

/** An identity file holding `CURRENT` (minted at `createdAt`) and the given retired identities. */
async function writeIdentityFile(
  home: string,
  createdAt: number,
  retired: Array<typeof RETIRED & { retiredAt: string }>,
) {
  const text = JSON.stringify({ ...CURRENT, createdAt: new Date(createdAt).toISOString(), retired });
  await fsp.writeFile(identityFile(home), `${text}\n`, { mode: 0o600 });
}

describe("the eval CLI's install identity", () => {
  it("is minted once, private, reused, and rotated after 90 days, keeping the old one", async () => {
    const home = await evalHome();
    const first = await evalInstallIdentity(home, () => NOW);
    assert.match(first.installId, INSTALL_ID_PATTERN);
    assert.equal((await fsp.stat(identityFile(home))).mode & 0o077, 0);
    assert.deepEqual(await evalInstallIdentity(home, () => NOW + 1000), first);
    const later = await evalInstallIdentity(home, () => NOW + 91 * DAY);
    assert.notEqual(later.installId, first.installId);
    const kept = await readInstallIdentities(home);
    assert.deepEqual(
      kept?.retired.map(({ installId, secret }) => ({ installId, secret })),
      [first],
      "the old identity is retired, not overwritten",
    );
    assert.equal((await fsp.stat(identityFile(home))).mode & 0o077, 0);
  });

  it("drops a retired identity once the server no longer keeps its rows", async () => {
    const home = await evalHome();
    await writeIdentityFile(home, NOW - 91 * DAY, [{ ...RETIRED, retiredAt: new Date(NOW - 181 * DAY).toISOString() }]);
    await evalInstallIdentity(home, () => NOW);
    const kept = await readInstallIdentities(home);
    assert.deepEqual(
      kept?.retired.map((old) => old.installId),
      [CURRENT.installId],
    );
  });

  it("refuses a home inside a Git worktree and an identity file that does not parse, changing nothing", async () => {
    const repo = await tmpDir("eval-repo-");
    await fsp.mkdir(path.join(repo, ".git"));
    await assert.rejects(evalInstallIdentity(repo, () => NOW));
    await assert.rejects(fsp.stat(identityFile(repo)), "nothing written inside the checkout");
    const hostile = [
      "{not json",
      '{"installId":"../x","secret":"y","createdAt":"z"}',
      JSON.stringify({ ...CURRENT, createdAt: "2026-10-01T00:00:00Z", retired: "x" }),
      JSON.stringify({ ...CURRENT, createdAt: "2026-10-01T00:00:00Z", retired: [{ installId: "../x" }] }),
    ];
    for (const text of hostile) {
      const home = await evalHome();
      await fsp.writeFile(identityFile(home), text, { mode: 0o600 });
      await assert.rejects(
        evalInstallIdentity(home, () => NOW),
        text,
      );
      assert.equal(await fsp.readFile(identityFile(home), "utf8"), text, "the file is never minted over");
    }
  });
});

function unshareDeps(home: string, answers: Parameters<typeof fakeFetch>[0], confirm = true) {
  const lines: string[] = [];
  const questions: string[] = [];
  const fake = fakeTransport(answers);
  const deps: UnshareDeps = {
    env: { [EVALS_HOME_ENV]: home, [RUNS_ORIGIN_ENV]: ORIGIN },
    identities: () => readInstallIdentities(home),
    record: shareRecord(home),
    confirm: async (question) => {
      questions.push(question);
      return confirm;
    },
    transport: fake.transport,
    out: (line) => lines.push(line),
  };
  return { deps, lines, questions, ...fake };
}

/** A shared-record line for `installId`. */
const entryOf = (installId: string, rep: number) => ({
  installId,
  campaignId: CAMPAIGN,
  runId: runIdFor(rep),
  gradeSeq: 0,
  contributedAt: "2026-10-01T12:00:00Z",
});

describe("ledger unshare", () => {
  it("deletes the rows of the current and every retired identity, each with its own secret", async () => {
    const home = await evalHome();
    await writeIdentityFile(home, NOW, [{ ...RETIRED, retiredAt: new Date(NOW - DAY).toISOString() }]);
    const record = shareRecord(home);
    await record.add(entryOf(CURRENT.installId, 1));
    await record.add(entryOf(RETIRED.installId, 2));
    const { deps, seen, lines } = unshareDeps(home, [
      json(200, { installId: CURRENT.installId, deleted: 3 }),
      json(404, { code: DesktopEvalErrorCode.NotFound }),
    ]);
    assert.equal(await ledgerUnshareCommand(deps)(["--yes"]), 0, lines.join("\n"));
    assert.deepEqual(
      seen.map((request) => [request.method, new URL(request.url).pathname.split("/").at(-1)]),
      [
        ["DELETE", CURRENT.installId],
        ["DELETE", RETIRED.installId],
      ],
    );
    assert.deepEqual(
      seen.map((request) => request.headers[INSTALL_SECRET_HEADER]),
      [CURRENT.secret, RETIRED.secret],
    );
    for (const request of seen) {
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.cookie, undefined);
    }
    assert.ok(lines.includes(`${UnshareLine.Deleted} ${CURRENT.installId} 3`), lines.join("\n"));
    assert.ok(lines.includes(`${UnshareLine.Deleted} ${RETIRED.installId} 0`), lines.join("\n"));
    assert.deepEqual(await record.entries(), [], "deleted rows may be shared again");
    assert.equal(lines.join("\n").includes(CURRENT.secret), false, "a secret is never printed");
  });

  it("asks first; a no deletes nothing", async () => {
    const home = await evalHome();
    await writeIdentityFile(home, NOW, []);
    const { deps, seen, questions } = unshareDeps(
      home,
      [json(200, { installId: CURRENT.installId, deleted: 1 })],
      false,
    );
    assert.equal(await ledgerUnshareCommand(deps)([]), 1);
    assert.equal(questions.length, 1);
    assert.equal(seen.length, 0);
  });

  it("keeps the record of an identity whose delete failed, and exits 1", async () => {
    const home = await evalHome();
    await writeIdentityFile(home, NOW, [{ ...RETIRED, retiredAt: new Date(NOW - DAY).toISOString() }]);
    const record = shareRecord(home);
    await record.add(entryOf(CURRENT.installId, 1));
    const { deps, seen, lines } = unshareDeps(home, [
      json(403, { code: DesktopEvalErrorCode.InvalidProof }),
      json(200, { installId: RETIRED.installId, deleted: 2 }),
    ]);
    assert.equal(await ledgerUnshareCommand(deps)(["--yes"]), 1);
    assert.equal(seen.length, 2, "the other identities are still deleted");
    assert.ok(lines.includes(`${UnshareLine.Stopped} ${CURRENT.installId} ${DesktopEvalErrorCode.InvalidProof}`));
    assert.equal((await record.entries()).length, 1);
  });

  it("makes no call without an identity, and refuses a malformed identity file or a removed origin", async () => {
    const empty = await evalHome();
    const none = unshareDeps(empty, []);
    assert.equal(await ledgerUnshareCommand(none.deps)(["--yes"]), 0);
    assert.equal(none.seen.length, 0);
    assert.ok(none.lines.includes(UnshareLine.NoIdentity));
    const bad = await evalHome();
    await fsp.writeFile(identityFile(bad), "{not json", { mode: 0o600 });
    const malformed = unshareDeps(bad, []);
    assert.equal(await ledgerUnshareCommand(malformed.deps)(["--yes"]), 1);
    assert.equal(malformed.seen.length, 0);
    const removed = unshareDeps(bad, []);
    removed.deps.env = { [RUNS_ORIGIN_ENV]: "" };
    assert.equal(await ledgerUnshareCommand(removed.deps)(["--yes"]), 1);
    assert.equal(removed.seen.length, 0);
  });

  it("usage errors exit 64 and send nothing", async () => {
    const home = await evalHome();
    await writeIdentityFile(home, NOW, []);
    const { deps, seen } = unshareDeps(home, []);
    for (const args of [["x"], ["--force"], ["--yes", "x"]]) assert.equal(await ledgerUnshareCommand(deps)(args), 64);
    assert.equal(seen.length, 0);
  });
});
