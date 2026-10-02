/**
 * `campaign plan` (§12, Rules 20–21): the matrix of cases × lanes × reps (× apps for Genex lanes),
 * one stream per provider account, each stream's builds in a seeded order rep by rep, canaries
 * bracketing every (lane, app), the estimates, the refusals, and the campaign file's boundary
 * (a hostile campaign id names no path and writes nothing). Hermetic: fixture cases and registry.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  CampaignPlanError,
  CampaignRefusal,
  campaignDir,
  formatPlan,
  type PlanInput,
  planCampaign,
  plannedRuns,
  readCampaignPlan,
  writeCampaignPlan,
} from "../../scripts/evals/campaign/plan.ts";
import { AppRole, CanaryBracket, CANARY_CASE_ID } from "../../scripts/evals/campaign/types.ts";
import { parseCases } from "../../scripts/evals/cases.ts";
import { validateLaneRegistry } from "../../scripts/evals/lanes/registry.ts";
import { evalsPaths } from "../../scripts/evals/ledger/paths.ts";
import { RUN_ID_PATTERN } from "../../scripts/evals/ledger/types.ts";
import { GraderFamily, RowKind } from "../../scripts/evals/vocabulary.ts";
import { EngineId } from "../../src/shared/providers.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/evals/campaign");
const CASES = parseCases(fs.readFileSync(path.join(FIXTURES, "cases.md"), "utf8"));
const REGISTRY = validateLaneRegistry(JSON.parse(fs.readFileSync(path.join(FIXTURES, "lanes.json"), "utf8")));
const BASE = "a".repeat(40);
const CAND = "b".repeat(40);
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-campaign-plan-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    cases: CASES,
    registry: REGISTRY,
    caseIds: ["tiny-roll", "tiny-jump"],
    laneSelectors: ["primary"],
    reps: 2,
    apps: [BASE],
    deadlineMin: null,
    seed: "s1",
    label: "smoke",
    nowMs: NOW,
    ...overrides,
  };
}

describe("the campaign matrix", () => {
  it("splits the lanes into one stream per provider and counts cases × lanes × reps", () => {
    const plan = planCampaign(input());
    assert.equal(plan.campaignId, "20261001T120000-smoke");
    assert.deepEqual(
      plan.streams.map((stream) => stream.engine),
      [EngineId.ClaudeCode, EngineId.Codex],
    );
    const [claude, codex] = plan.streams;
    assert.equal(claude?.builds.length, 2 * 2 * 2);
    assert.equal(codex?.builds.length, 1 * 2 * 2);
    for (const run of plannedRuns(plan)) assert.match(run.runId, RUN_ID_PATTERN);
    assert.equal(new Set(plannedRuns(plan).map((run) => run.runId)).size, plannedRuns(plan).length);
  });

  it("brackets every (lane, app) of a stream with an opening canary, its retry and a closing canary", () => {
    const plan = planCampaign(input({ apps: [BASE, CAND] }));
    const claude = plan.streams[0];
    assert.ok(claude);
    const openings = claude.opening.filter((run) => run.bracket === CanaryBracket.Opening);
    assert.deepEqual(
      openings.map((run) => [run.laneId, run.app?.role ?? null]),
      [
        ["genex-claude", AppRole.Base],
        ["genex-claude", AppRole.Candidate],
        ["raw-claude", null],
      ],
    );
    assert.equal(claude.opening.filter((run) => run.bracket === CanaryBracket.OpeningRetry).length, 3);
    assert.equal(claude.closing.length, 3);
    for (const run of [...claude.opening, ...claude.closing]) {
      assert.equal(run.kind, RowKind.Canary);
      assert.equal(run.caseId, CANARY_CASE_ID);
    }
  });

  it("runs Genex lanes once per app on the version axis and raw lanes once, with no app", () => {
    const plan = planCampaign(input({ apps: [BASE, CAND], reps: 1 }));
    const builds = plan.streams.flatMap((stream) => stream.builds);
    const genex = builds.filter((run) => run.laneId === "genex-claude");
    assert.deepEqual(genex.map((run) => run.app?.sha).sort(), [BASE, BASE, CAND, CAND]);
    assert.ok(genex.some((run) => run.runId.endsWith("-tiny-roll-cand-r1")));
    assert.ok(builds.filter((run) => run.laneId !== "genex-claude").every((run) => run.app === null));
  });

  it("orders each stream rep by rep in a seeded order: the same seed repeats it, another seed moves it", () => {
    const order = (seed: string) => planCampaign(input({ seed, reps: 3 })).streams[0]?.builds.map((run) => run.runId);
    assert.deepEqual(order("s1"), order("s1"));
    const seeds = ["s1", "s2", "s3", "s4", "s5"].map((seed) => JSON.stringify(order(seed)));
    assert.ok(new Set(seeds).size > 1);
    const reps = planCampaign(input({ reps: 3 })).streams[0]?.builds.map((run) => run.rep);
    assert.deepEqual(
      reps,
      [...(reps ?? [])].sort((a, b) => a - b),
    );
  });

  it("drops a listed canary from the builds and keeps each case's own deadline unless one is given", () => {
    const plan = planCampaign(input({ caseIds: ["tiny-roll", CANARY_CASE_ID] }));
    assert.ok(plan.streams.every((stream) => stream.builds.every((run) => run.caseId === "tiny-roll")));
    assert.deepEqual(
      plan.cases.map((c) => [c.id, c.deadlineMin]),
      [
        ["tiny-roll", 10],
        [CANARY_CASE_ID, 30],
      ],
    );
    const forced = planCampaign(input({ deadlineMin: 5 }));
    assert.deepEqual(
      forced.cases.map((c) => [c.id, c.deadlineMin]),
      [
        ["tiny-roll", 5],
        ["tiny-jump", 5],
        [CANARY_CASE_ID, 30],
      ],
    );
  });

  it("estimates build hours per stream, grading calls per family and quota windows", () => {
    const plan = planCampaign(input({ laneSelectors: ["raw-claude", "raw-codex"], reps: 1, apps: [] }));
    // Claude stream: an opening and a closing canary (30 + 5 min each) and two builds (10 + 5, 20 + 5).
    assert.equal(
      plan.estimates.buildHoursByStream[EngineId.ClaudeCode],
      Math.round(((35 + 35 + 15 + 25) / 60) * 10) / 10,
    );
    assert.equal(plan.estimates.buildHoursWall, plan.estimates.buildHoursByStream[EngineId.ClaudeCode]);
    assert.equal(plan.estimates.quotaWindowsByStream[EngineId.Codex], 1);
    // Checklist votes: per build, every item (control included) × 3 votes; pairwise: raw-claude vs raw-codex × 2 cases × 2 orders.
    const votes = 2 * (3 * 3 + 2 * 3);
    assert.equal(plan.estimates.gradingCallsByFamily[GraderFamily.Claude], votes + 4);
    assert.equal(plan.estimates.builds, 4);
    assert.match(formatPlan(plan), /estimates: 4 builds/);
  });
});

describe("plan refusals", () => {
  const cases: Array<[string, Partial<PlanInput>, CampaignRefusal]> = [
    ["an unknown case", { caseIds: ["nope"] }, CampaignRefusal.UnknownCase],
    ["only the canary", { caseIds: [CANARY_CASE_ID] }, CampaignRefusal.NoCases],
    ["an unknown lane", { laneSelectors: ["nope"] }, CampaignRefusal.UnknownLane],
    ["a future lane", { laneSelectors: ["later-lane"] }, CampaignRefusal.FutureLane],
    ["zero reps", { reps: 0 }, CampaignRefusal.BadReps],
    ["fractional reps", { reps: 1.5 }, CampaignRefusal.BadReps],
    ["a negative deadline", { deadlineMin: -1 }, CampaignRefusal.BadDeadline],
    ["a seed with a slash", { seed: "a/b" }, CampaignRefusal.BadSeed],
    ["a label with a path", { label: "../x" }, CampaignRefusal.BadLabel],
    ["a label the ledger guard would refuse as a secret", { label: "nightly-sk-run" }, CampaignRefusal.BadLabel],
    ["a Genex lane without an app", { apps: [] }, CampaignRefusal.BadApps],
    ["three apps", { apps: [BASE, CAND, "c".repeat(40)] }, CampaignRefusal.BadApps],
    ["the same app twice", { apps: [BASE, BASE] }, CampaignRefusal.BadApps],
    ["a short SHA", { apps: ["abc1234"] }, CampaignRefusal.BadApps],
  ];
  for (const [name, overrides, refusal] of cases) {
    it(`refuses ${name}`, () => {
      assert.throws(
        () => planCampaign(input(overrides)),
        (error: unknown) => error instanceof CampaignPlanError && error.refusal === refusal,
      );
    });
  }
});

describe("the campaign file", () => {
  it("writes campaign.json under campaigns/<id> once and reads it back", async () => {
    const paths = evalsPaths(path.join(tmp, "home-a"));
    const plan = planCampaign(input());
    const file = await writeCampaignPlan(paths, plan);
    assert.equal(file, path.join(tmp, "home-a", "campaigns", plan.campaignId, "campaign.json"));
    assert.deepEqual(await readCampaignPlan(paths, plan.campaignId), plan);
    await assert.rejects(writeCampaignPlan(paths, plan), { code: "EEXIST" });
  });

  const hostile = ["../x", "/etc/passwd", "20261001T120000-a/../../b", "", "20261001T120000-A", "x"];
  for (const id of hostile) {
    it(`refuses the campaign id ${JSON.stringify(id)} and touches nothing`, async () => {
      const home = path.join(tmp, `home-${hostile.indexOf(id)}-hostile`);
      const paths = evalsPaths(home);
      assert.throws(() => campaignDir(paths, id), { name: "CampaignPlanError" });
      await assert.rejects(readCampaignPlan(paths, id), { name: "CampaignPlanError" });
      assert.equal(fs.existsSync(home), false);
    });
  }

  it("refuses a campaign file that is not this campaign's plan", async () => {
    const paths = evalsPaths(path.join(tmp, "home-b"));
    const plan = planCampaign(input());
    const dir = campaignDir(paths, plan.campaignId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "campaign.json"), JSON.stringify({ ...plan, campaignId: "20261001T120000-other" }));
    await assert.rejects(readCampaignPlan(paths, plan.campaignId), (error: unknown) => {
      return error instanceof CampaignPlanError && error.refusal === CampaignRefusal.BadPlanFile;
    });
    await assert.rejects(readCampaignPlan(paths, "20261001T120000-missing"), { name: "CampaignPlanError" });
  });
});
