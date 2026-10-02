/**
 * The local ledger (§9.2, §6.3, Rule 10): `$GENEX_EVALS_HOME` resolution, the append-only writer
 * (two appends both land; every refused row leaves the file neither created nor grown; holdouts
 * never land inside a Git worktree, also through a link; nothing lands in the studio's own homes),
 * the reader (a malformed line is named by number; conflicting regrades are refused;
 * `currentRows()` keeps the latest grade) and the per-release export (public cases only).
 * Hermetic: temp folders and a temp Git repository; no provider, no real home.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { appendFile, mkdir, readFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  exportFileName,
  exportLedger,
  LEDGER_EXPORT_DIR,
  selectExportRows,
} from "../../scripts/evals/ledger/export.ts";
import { LedgerGuardError } from "../../scripts/evals/ledger/guard.ts";
import {
  EvalsPathError,
  EVALS_HOME_ENV,
  evalsPaths,
  evidenceDir,
  insideGitWorktree,
  resolveEvalsHome,
} from "../../scripts/evals/ledger/paths.ts";
import {
  LedgerReadError,
  currentRows,
  readLedgerFile,
  readRunRows,
  validateLedger,
} from "../../scripts/evals/ledger/read.ts";
import type { RunRow } from "../../scripts/evals/ledger/types.ts";
import {
  LedgerRefusal,
  LedgerWriteError,
  appendLedgerRow,
  gradeIdFor,
  withGradeId,
} from "../../scripts/evals/ledger/write.ts";
import { defaultHomes } from "../../scripts/transcript-census.ts";
import { gitFile } from "../helpers/git.ts";
import { tmpDir } from "../helpers/tmp.ts";

const fixtures = path.resolve(import.meta.dirname, "../fixtures/evals/ledger");
const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.json`), "utf8"));

/** A stamped copy of the synthetic run row with `change` applied. */
function runRow(change: (row: RunRow) => void = () => {}): RunRow {
  const row = fixture<RunRow>("run-row");
  change(row);
  return withGradeId(row);
}

/** A fresh evals home in a fresh fake user home, with that user's owned homes. */
async function sandbox(prefix = "eval-ledger-") {
  const user = await tmpDir(prefix);
  const paths = evalsPaths(path.join(user, ".genex-evals"));
  return { user, paths, homes: defaultHomes(user) };
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

describe("the evals home", () => {
  it("defaults to ~/.genex-evals and honours an absolute override", () => {
    assert.equal(resolveEvalsHome({ env: {}, home: "/h" }), path.join("/h", ".genex-evals"));
    assert.equal(resolveEvalsHome({ env: { [EVALS_HOME_ENV]: "" }, home: "/h" }), path.join("/h", ".genex-evals"));
    assert.equal(
      resolveEvalsHome({ env: { [EVALS_HOME_ENV]: "/data/evals" }, home: "/h" }),
      path.resolve("/data/evals"),
    );
    assert.throws(() => resolveEvalsHome({ env: { [EVALS_HOME_ENV]: "relative/evals" }, home: "/h" }), EvalsPathError);
  });

  it("lays out the ledger, evidence, work, builds, homes, secrets and campaigns folders beneath it", () => {
    const paths = evalsPaths("/e");
    assert.deepEqual(
      [paths.ledger, paths.evidence, paths.work, paths.builds, paths.homes, paths.secrets, paths.campaigns],
      ["/e/ledger", "/e/evidence", "/e/work", "/e/builds", "/e/homes", "/e/secrets", "/e/campaigns"].map((p) =>
        path.resolve(p),
      ),
    );
    assert.deepEqual(
      Object.values(paths.ledgerFiles),
      ["runs", "pairwise", "human"].map((n) => path.resolve(`/e/ledger/${n}.jsonl`)),
    );
  });

  it("lays the snapshot server's copies, npm cache and sandbox scratch under work/", () => {
    const paths = evalsPaths("/e");
    assert.deepEqual(
      [paths.serveCopies, paths.npmCache, paths.sandboxScratch],
      ["/e/work/grade-copies", "/e/work/npm-cache", "/e/work/sandbox-scratch"].map((p) => path.resolve(p)),
    );
  });

  it("puts a run's evidence under its runId unless an override names the folder", () => {
    const paths = evalsPaths("/e");
    const runId = "20261002T101500-genex-claude-sample-case-r1";
    assert.equal(evidenceDir(paths, runId), path.resolve("/e/evidence", runId));
    assert.equal(evidenceDir(paths, runId, "/tmp/elsewhere"), path.resolve("/tmp/elsewhere"));
  });

  for (const runId of ["../escape", "/abs/path", "a/b", "", "20261002T101500-genex-claude-x-r1/../../x"])
    it(`refuses the evidence runId ${JSON.stringify(runId)} and creates nothing`, async () => {
      const { paths } = await sandbox();
      assert.throws(() => evidenceDir(paths, runId), EvalsPathError);
      assert.equal(await sizeOf(paths.home), null);
    });
});

describe("appendLedgerRow", () => {
  it("lands two sequential appends and two concurrent ones, one line each", async () => {
    const { paths, homes } = await sandbox();
    const first = runRow();
    const second = runRow((row) => {
      row.gradeSeq = 2;
      row.recordedAt = "2026-10-03T09:00:00Z";
    });
    assert.equal(await appendLedgerRow(first, { paths, homes }), paths.ledgerFiles.runs);
    await appendLedgerRow(second, { paths, homes });
    await Promise.all([
      appendLedgerRow(fixture("pairwise-row"), { paths, homes }),
      appendLedgerRow(fixture("human-row"), { paths, homes }),
    ]);
    const lines = (await readFile(paths.ledgerFiles.runs, "utf8")).split("\n");
    assert.deepEqual(lines, [JSON.stringify(first), JSON.stringify(second), ""]);
    assert.deepEqual(await readRunRows(paths), [first, second]);
    assert.equal((await readLedgerFile(paths.ledgerFiles.pairwise)).length, 1);
    assert.equal((await readLedgerFile(paths.ledgerFiles.human)).length, 1);
  });
});

describe("appendLedgerRow refusals", () => {
  const hostile: Array<[string, () => unknown]> = [
    ["a string", () => "not a row"],
    ["null", () => null],
    ["an unknown key", () => ({ ...runRow(), extra: 1 })],
    [
      "a free-text reason",
      () => runRow((row) => Object.assign(row.cost, { apiEquivalentUsd: { unavailable: true, reason: "x" } })),
    ],
    [
      "an internal domain as a model id",
      () => runRow((row) => Object.assign(row.model, { requested: ["api", "genex", "games"].join(".") })),
    ],
    [
      "a key as a model id",
      () => runRow((row) => Object.assign(row.model, { main: ["sk", "ant", "abcdef123456"].join("-") })),
    ],
    ["a stale gradeId", () => ({ ...runRow(), gradeId: "0123456789ab" })],
    ["an unrecognised schema", () => ({ ...runRow(), schema: "genex-evals/run/9" })],
  ];
  for (const [name, make] of hostile) {
    it(`refuses ${name} without creating the ledger`, async () => {
      const { paths, homes } = await sandbox();
      await assert.rejects(appendLedgerRow(make(), { paths, homes }));
      assert.equal(await sizeOf(paths.ledger), null);
    });
    it(`refuses ${name} without growing the ledger`, async () => {
      const { paths, homes } = await sandbox();
      await appendLedgerRow(runRow(), { paths, homes });
      const before = await sizeOf(paths.ledgerFiles.runs);
      await assert.rejects(appendLedgerRow(make(), { paths, homes }));
      assert.equal(await sizeOf(paths.ledgerFiles.runs), before);
    });
  }

  it("names the guard rule of a refused row", async () => {
    const { paths, homes } = await sandbox();
    await assert.rejects(
      appendLedgerRow({ ...runRow(), runId: "bad" }, { paths, homes }),
      (error: unknown) => error instanceof LedgerGuardError && error.field === "runId",
    );
    await assert.rejects(
      appendLedgerRow({ ...runRow(), gradeId: "0123456789ab" }, { paths, homes }),
      (error: unknown) => error instanceof LedgerWriteError && error.refusal === LedgerRefusal.GradeIdMismatch,
    );
  });
});

describe("appendLedgerRow boundaries", () => {
  it("refuses a holdout row inside a Git worktree, also through a link, and keeps it outside one", async () => {
    const repo = await tmpDir("eval-ledger-repo-");
    await gitFile(["init", "--quiet", repo]);
    const { user, homes } = await sandbox();
    const holdout = runRow((row) => Object.assign(row.case, { visibility: "holdout" }));
    const inRepo = evalsPaths(path.join(repo, "nested", "evals-home"));
    await symlink(repo, path.join(user, "linked-repo"));
    const throughLink = evalsPaths(path.join(user, "linked-repo", "evals-home"));
    for (const paths of [inRepo, throughLink]) {
      assert.equal(await insideGitWorktree(paths.ledger), true);
      await assert.rejects(
        appendLedgerRow(holdout, { paths, homes }),
        (error: unknown) => error instanceof LedgerWriteError && error.refusal === LedgerRefusal.HoldoutInWorktree,
      );
      assert.equal(await sizeOf(paths.home), null);
    }
    await appendLedgerRow(runRow(), { paths: inRepo, homes });
    assert.equal((await readRunRows(inRepo)).length, 1);
    const outside = evalsPaths(path.join(user, "evals-home"));
    assert.equal(await insideGitWorktree(outside.ledger), false);
    await appendLedgerRow(holdout, { paths: outside, homes });
    assert.deepEqual(await readRunRows(outside), [holdout]);
  });

  it("refuses a ledger inside the studio's or an engine's own home, also through a link", async () => {
    const { user, homes } = await sandbox();
    const owned = evalsPaths(path.join(user, ".claude", "evals"));
    await mkdir(path.join(user, ".codex"), { recursive: true });
    await symlink(path.join(user, ".codex"), path.join(user, "codex-link"));
    const linked = evalsPaths(path.join(user, "codex-link", "evals"));
    for (const paths of [owned, linked]) {
      await assert.rejects(
        appendLedgerRow(runRow(), { paths, homes }),
        (error: unknown) => error instanceof LedgerWriteError && error.refusal === LedgerRefusal.OwnedOutput,
      );
      assert.equal(await sizeOf(paths.home), null);
    }
  });

  it("refuses a ledger file that is a link into an engine's home, leaving the target as it was", async () => {
    const { user, paths, homes } = await sandbox();
    const victim = path.join(user, ".claude", "history.jsonl");
    await mkdir(path.dirname(victim), { recursive: true });
    await appendFile(victim, "{}\n");
    await mkdir(paths.ledger, { recursive: true });
    await symlink(victim, paths.ledgerFiles.runs);
    await assert.rejects(
      appendLedgerRow(runRow(), { paths, homes }),
      (error: unknown) => error instanceof LedgerWriteError && error.refusal === LedgerRefusal.OwnedOutput,
    );
    assert.equal(await readFile(victim, "utf8"), "{}\n");
  });

  it("derives gradeId from the runId, the grading pins and recordedAt only", () => {
    const row = runRow();
    assert.match(row.gradeId, /^[0-9a-f]{12}$/);
    assert.equal(gradeIdFor(row.runId, row.pins.grading, row.recordedAt), row.gradeId);
    const regraded = runRow((next) => Object.assign(next.pins.grading, { endpointsSha: "0123456789ab" }));
    assert.notEqual(regraded.gradeId, row.gradeId);
    const renoted = runRow((next) => next.notes.push("co-run"));
    assert.equal(renoted.gradeId, row.gradeId);
  });
});

describe("the reader", () => {
  it("names the malformed line and reads a missing ledger as empty", async () => {
    const { paths, homes } = await sandbox();
    assert.deepEqual(await readRunRows(paths), []);
    await appendLedgerRow(runRow(), { paths, homes });
    await appendFile(paths.ledgerFiles.runs, '{"schema":\n', { flag: "a" });
    await assert.rejects(
      readRunRows(paths),
      (error: unknown) => error instanceof LedgerReadError && error.line === 2 && error.message.includes(":2"),
    );
  });

  it("names a well-formed line that breaks the schema, and a row in the wrong file", async () => {
    const { paths, homes } = await sandbox();
    await appendLedgerRow(runRow(), { paths, homes });
    await appendFile(paths.ledgerFiles.runs, `${JSON.stringify({ ...runRow(), kind: "demo" })}\n`, { flag: "a" });
    await assert.rejects(readRunRows(paths), (error: unknown) => error instanceof LedgerReadError && error.line === 2);
    const other = await sandbox();
    await mkdir(other.paths.ledger, { recursive: true });
    await appendFile(other.paths.ledgerFiles.runs, `${JSON.stringify(fixture("human-row"))}\n`, { flag: "a" });
    await assert.rejects(
      readRunRows(other.paths),
      (error: unknown) => error instanceof LedgerReadError && error.line === 1,
    );
  });

  it("keeps the latest grade per run: a later gradeSeq wins over an earlier recordedAt", () => {
    const first = runRow();
    const regrade = runRow((row) => Object.assign(row, { gradeSeq: 2, recordedAt: "2026-10-01T00:00:00Z" }));
    const other = runRow((row) => Object.assign(row, { runId: "20261002T101500-raw-claude-sample-case-r1" }));
    const current = currentRows([regrade, other, first, first]);
    assert.deepEqual(current, [regrade, other]);
  });

  it("refuses two different rows for the same (runId, gradeSeq), in currentRows and validateLedger", async () => {
    const first = runRow();
    const conflicting = runRow((row) => row.notes.push("co-run"));
    assert.throws(() => currentRows([first, conflicting]), LedgerReadError);
    const { paths, homes } = await sandbox();
    await appendLedgerRow(first, { paths, homes });
    await appendLedgerRow(first, { paths, homes });
    assert.deepEqual(await validateLedger(paths), { runs: 2, currentRuns: 1, pairwise: 0, human: 0 });
    await appendLedgerRow(conflicting, { paths, homes });
    await assert.rejects(
      validateLedger(paths),
      (error: unknown) => error instanceof LedgerReadError && error.line === 3,
    );
  });
});

describe("exportLedger", () => {
  const APP_SHA = "47f7e286";
  const holdout = () =>
    runRow((row) => {
      row.runId = "20261002T101500-genex-claude-secret-case-r1";
      Object.assign(row.case, { id: "secret-case", visibility: "holdout" });
    });
  const raw = () =>
    runRow((row) => {
      row.runId = "20261002T101500-raw-claude-sample-case-r1";
      row.pins.run.appSha = { na: true };
    });
  const otherRelease = () =>
    runRow((row) => {
      row.runId = "20261003T101500-genex-claude-sample-case-r1";
      row.campaignId = "20261003T100000-smoke";
      row.pins.run.appSha = "1234abcd";
    });

  it("selects the current public rows of the release's campaigns", () => {
    const regrade = runRow((row) => Object.assign(row, { gradeSeq: 2 }));
    const selected = selectExportRows([runRow(), regrade, holdout(), raw(), otherRelease()], APP_SHA);
    assert.deepEqual(
      selected.map((row) => [row.runId, row.gradeSeq]),
      [
        ["20261002T101500-genex-claude-sample-case-r1", 2],
        ["20261002T101500-raw-claude-sample-case-r1", 1],
      ],
    );
  });

  it("writes evals/ledger/export-<appSha>.jsonl without holdouts", async () => {
    const { paths, homes } = await sandbox();
    const outside = await tmpDir("eval-ledger-repo-root-");
    for (const row of [runRow(), holdout(), raw(), otherRelease()]) await appendLedgerRow(row, { paths, homes });
    const result = await exportLedger({ paths, appSha: APP_SHA, repoRoot: outside });
    assert.equal(result.file, path.join(outside, LEDGER_EXPORT_DIR, `export-${APP_SHA}.jsonl`));
    assert.deepEqual(result, { file: result.file, rows: 2, holdoutsSkipped: 1 });
    const text = await readFile(result.file, "utf8");
    assert.equal(text.includes("secret-case"), false);
    assert.deepEqual(
      text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line).runId),
      ["20261002T101500-genex-claude-sample-case-r1", "20261002T101500-raw-claude-sample-case-r1"],
    );
  });

  for (const appSha of ["../escape", "HEAD", "47f7e286/../x", "", "a".repeat(41)])
    it(`refuses the app sha ${JSON.stringify(appSha)} and writes nothing`, async () => {
      const { paths } = await sandbox();
      const root = await tmpDir("eval-ledger-repo-root-");
      assert.throws(() => exportFileName(appSha));
      await assert.rejects(exportLedger({ paths, appSha, repoRoot: root }));
      assert.equal(await sizeOf(path.join(root, "evals")), null);
    });
});
