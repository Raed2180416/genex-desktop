/**
 * The eval contracts hold together: `evals/lanes.json` rows satisfy the registry validator (and a
 * hostile row is refused by name), `evals/prices.json` is a dated table where an unknown price is
 * never a number, every vocabulary's wire values are unique, the remote route constants are
 * well-formed, and the CLI skeleton answers `not-implemented` for a command without a handler.
 * Hermetic: it reads committed data files and loads modules; it never reaches a provider.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { COMMANDS, EXIT_USAGE, findCommand, main } from "../../scripts/eval.ts";
import { RUN_ID_PATTERN, isMeasured, NOT_APPLICABLE, unavailable } from "../../scripts/evals/ledger/types.ts";
import { laneFlagsDigest } from "../../scripts/evals/lanes/argv.ts";
import {
  LANE_REGISTRY_FILE,
  LaneRegistryError,
  laneById,
  readLaneRegistry,
  validateLaneRow,
} from "../../scripts/evals/lanes/registry.ts";
import {
  PRICE_TABLE_FILE,
  PriceTableError,
  apiEquivalentUsd,
  readPriceTable,
  validatePriceTable,
} from "../../scripts/evals/prices.ts";
import {
  ANONYMOUS_ROUTES,
  DESKTOP_EVAL_METHOD,
  DesktopEvalRoute,
  DesktopEvalStatus,
  EVALS_INGEST_ROUTES,
  contributionPath,
  evidencePath,
  gradesPath,
} from "../../scripts/evals/remote/contract.ts";
import * as vocabulary from "../../scripts/evals/vocabulary.ts";
import { GENEX_PLUGIN_ID } from "../../src/shared/genex.ts";
import { EngineId } from "../../src/shared/providers.ts";
import {
  CONSENT_VERSION_PATTERN,
  INSTALL_ID_PATTERN,
  RUN_SHARING_ASK,
  RUN_SHARING_CONSENT_VERSION,
  RunSharingAsk,
} from "../../src/shared/run-sharing.ts";

const root = path.resolve(import.meta.dirname, "../..");
const registry = readLaneRegistry(root);
const lanes = registry.lanes;
const baseLane = () => structuredClone(lanes[0]);

describe("lane registry", () => {
  it("lists the planned lanes and the four fixture lanes, each valid, with ids that are never an engine id", () => {
    assert.deepEqual(
      lanes.map((lane) => lane.id),
      [
        "genex-claude",
        "raw-claude",
        "raw-codex",
        "genex-codex",
        "genex-claude-auto",
        "genex-codex-auto",
        "genex-claude-plugin-off",
        "genex-codex-plugin-off",
        "fixture-genex",
        "fixture-raw",
        "fixture-raw-codex",
        "fixture-genex-codex",
      ],
    );
    for (const lane of lanes) assert.ok(!Object.values(EngineId).includes(lane.id as never), lane.id);
    assert.equal(laneById(registry, "raw-codex")?.engine, EngineId.Codex);
    assert.equal(laneById(registry, "no-such-lane"), undefined);
  });

  it("pins the plan's models, one effort per model, and marks only the fixture lanes hermetic", () => {
    const models = new Map<string, Set<string>>();
    for (const lane of lanes.filter((lane) => !lane.fixture)) {
      models.set(lane.model, (models.get(lane.model) ?? new Set()).add(lane.effort));
    }
    assert.deepEqual([...models.keys()].sort(), ["claude-opus-5-5", "gpt-6.1-sol"]);
    for (const [model, efforts] of models) assert.equal(efforts.size, 1, `${model} has one pinned effort`);
    assert.deepEqual(
      lanes.filter((lane) => lane.fixture).map((lane) => lane.id),
      ["fixture-genex", "fixture-raw", "fixture-raw-codex", "fixture-genex-codex"],
    );
    for (const lane of lanes) assert.equal(lane.fixture, lane.status === vocabulary.LaneStatus.Fixture, lane.id);
  });

  it("refuses a hostile row by field, without reading anything else", () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ["id", { ...baseLane(), id: "codex" }],
      ["id", { ...baseLane(), id: "claude-code" }],
      ["id", { ...baseLane(), id: "Bad Lane" }],
      ["id", { ...baseLane(), id: "codex-sk-test" }],
      ["id", { ...baseLane(), id: "sk-lane" }],
      ["engine", { ...baseLane(), engine: "gemini-cli" }],
      ["agent", { ...baseLane(), agent: "human" }],
      ["mode", { ...baseLane(), mode: "director" }],
      ["network", { ...baseLane(), network: "yes" }],
      ["flagsDigest", { ...baseLane(), flagsDigest: "/Users/someone/argv" }],
      ["fixture", { ...baseLane(), fixture: "true" }],
      ["extra", { ...baseLane(), extra: 1 }],
      ["model", { ...baseLane(), model: "" }],
    ];
    for (const [field, row] of rows) {
      assert.throws(
        () => validateLaneRow(row, 3),
        (error: unknown) => error instanceof LaneRegistryError && error.field === field && error.rowIndex === 3,
        `${field}: ${JSON.stringify(row)}`,
      );
    }
    assert.throws(() => validateLaneRow(null), LaneRegistryError);
    assert.throws(() => validateLaneRow([baseLane()]), LaneRegistryError);
  });

  it("turns a Genex lane's plugins off by plugin id only, and never names plugins on a raw lane", () => {
    const genex = laneById(registry, "genex-claude");
    const raw = laneById(registry, "raw-claude");
    assert.ok(genex && raw);
    assert.deepEqual(validateLaneRow({ ...genex, disabledPlugins: [GENEX_PLUGIN_ID] }).disabledPlugins, [
      GENEX_PLUGIN_ID,
    ]);
    const rows: Array<[string, Record<string, unknown>]> = [
      ["disabledPlugins", { ...raw, disabledPlugins: [GENEX_PLUGIN_ID] }],
      ["disabledPlugins", { ...genex, disabledPlugins: GENEX_PLUGIN_ID }],
      ["disabledPlugins", { ...genex, disabledPlugins: [] }],
      ["disabledPlugins", { ...genex, disabledPlugins: ["Genex"] }],
      ["disabledPlugins", { ...genex, disabledPlugins: ["../genex"] }],
      ["disabledPlugins", { ...genex, disabledPlugins: [GENEX_PLUGIN_ID, GENEX_PLUGIN_ID] }],
    ];
    for (const [field, row] of rows) {
      assert.throws(
        () => validateLaneRow(row, 4),
        (error: unknown) => error instanceof LaneRegistryError && error.field === field && error.rowIndex === 4,
        JSON.stringify(row.disabledPlugins),
      );
    }
  });

  it("gives each plugin-off lane its plugin-on twin's pins, with the Genex plugin off and its own flags digest", () => {
    for (const [twin, off] of [
      ["genex-claude", "genex-claude-plugin-off"],
      ["genex-codex", "genex-codex-plugin-off"],
    ] as const) {
      const on = laneById(registry, twin);
      const lane = laneById(registry, off);
      assert.ok(on && lane, off);
      assert.deepEqual(lane.disabledPlugins, [GENEX_PLUGIN_ID]);
      assert.equal(on.disabledPlugins, undefined);
      const { id: _offId, disabledPlugins: _off, flagsDigest: offDigest, status, ...offPins } = lane;
      const { id: _onId, flagsDigest: onDigest, status: _status, ...onPins } = on;
      assert.deepEqual(offPins, onPins, off);
      assert.equal(status, vocabulary.LaneStatus.Harness);
      assert.notEqual(offDigest, onDigest, `${off}: turning a plugin off moves the flags digest`);
    }
  });

  it("pins every lane's flags to the digest of its own argv builder and instruction texts", () => {
    for (const lane of lanes) assert.equal(lane.flagsDigest, laneFlagsDigest(lane), lane.id);
  });

  it("is the committed file, formatted as data", () => {
    const text = fs.readFileSync(path.join(root, LANE_REGISTRY_FILE), "utf8");
    assert.equal(JSON.parse(text).lanes.length, lanes.length);
    assert.ok(text.endsWith("\n"));
  });
});

describe("price table", () => {
  const table = readPriceTable(root);

  it("is dated, priced per million tokens, and marks the Codex model unknown rather than guessed", () => {
    assert.match(table.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(table.models["gpt-6.1-sol"], { unknown: true });
    for (const [model, price] of Object.entries(table.models)) {
      if ("unknown" in price) continue;
      for (const value of Object.values(price)) assert.ok(value > 0, `${model} prices are positive`);
      assert.ok(price.cacheRead < price.input, `${model}: a cache read costs less than an uncached token`);
      assert.ok(price.cacheWrite > price.input, `${model}: a cache write costs more than an uncached token`);
    }
    for (const lane of lanes.filter((lane) => !lane.fixture)) assert.ok(table.models[lane.model], lane.model);
    assert.ok(fs.readFileSync(path.join(root, PRICE_TABLE_FILE), "utf8").endsWith("\n"));
  });

  it("prices a Claude cache write at the 1-hour rate, the only TTL Claude Code writes on a subscription", () => {
    // Every cache write in 195 in-app Claude Code sessions (4.4M tokens) was `ephemeral_1h`, which
    // bills at 2x input; the 5-minute 1.25x rate under-priced every lane's writes by 37.5%.
    for (const [model, price] of Object.entries(table.models)) {
      if ("unknown" in price || !model.startsWith("claude-")) continue;
      assert.equal(price.cacheWrite, price.input * 2, `${model}: a cache write is 2x input`);
    }
  });

  it("costs a usage at the published price and gives null, never a number, for an unknown one", () => {
    const usage = { uncachedInput: 1_000_000, cacheWrite: 0, cacheRead: 1_000_000, output: 100_000, reasoning: 20_000 };
    const opus = table.models["claude-opus-5-5"];
    assert.ok(opus && !("unknown" in opus));
    assert.equal(apiEquivalentUsd(table, "claude-opus-5-5", usage), opus.input + opus.cacheRead + opus.output / 10);
    assert.equal(apiEquivalentUsd(table, "gpt-6.1-sol", usage), null);
    assert.equal(apiEquivalentUsd(table, "no-such-model", usage), null);
  });

  it("refuses a malformed table by field", () => {
    const base = () => structuredClone(table) as unknown as Record<string, unknown>;
    const bad: Array<[string, unknown]> = [
      ["schema", { ...base(), schema: "prices/0" }],
      ["asOf", { ...base(), asOf: "yesterday" }],
      ["unit", { ...base(), unit: "usd" }],
      [
        "claude-opus-5-5.input",
        { ...base(), models: { "claude-opus-5-5": { input: -1, cacheWrite: 1, cacheRead: 1, output: 1 } } },
      ],
      [
        "claude-opus-5-5.output",
        { ...base(), models: { "claude-opus-5-5": { input: 1, cacheWrite: 1, cacheRead: 1 } } },
      ],
      ["gpt-6.1-sol", { ...base(), models: { "gpt-6.1-sol": { unknown: true, input: 3 } } }],
      [
        "claude-opus-5-5.billed",
        { ...base(), models: { "claude-opus-5-5": { input: 1, cacheWrite: 1, cacheRead: 1, output: 1, billed: 1 } } },
      ],
      ["Bad Model", { ...base(), models: { "Bad Model": { unknown: true } } }],
    ];
    for (const [field, value] of bad) {
      assert.throws(
        () => validatePriceTable(value),
        (error: unknown) => error instanceof PriceTableError && error.field === field,
        field,
      );
    }
  });
});

describe("vocabularies", () => {
  const isTable = (value: unknown): value is Record<string, string> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
  const tables: Array<[string, Record<string, string>]> = [];
  for (const [name, value] of Object.entries(vocabulary)) if (isTable(value)) tables.push([name, value]);

  it("has PascalCase keys and unique wire values in every table", () => {
    assert.ok(tables.length > 30, `${tables.length} tables`);
    for (const [name, table] of tables) {
      const values = Object.values(table);
      assert.equal(new Set(values).size, values.length, `${name} values are unique`);
      for (const key of Object.keys(table)) assert.match(key, /^[A-Z][A-Za-z0-9]*$/, `${name}.${key}`);
      for (const value of values) assert.match(value, /^[a-z0-9][a-z0-9._ /-]*$/, `${name}: ${value}`);
    }
  });

  it("never spells an engine id as a lane or agent value", () => {
    const engines = new Set<string>(Object.values(EngineId));
    for (const value of Object.values(vocabulary.EvalAgent)) assert.ok(!engines.has(value), value);
  });

  it("maps every check state to an exit code, and the plan's ended-how set exactly", () => {
    assert.deepEqual(Object.keys(vocabulary.CHECK_EXIT_CODE).sort(), Object.values(vocabulary.CheckState).sort());
    assert.deepEqual(Object.values(vocabulary.EndedHow), [
      "agent-finished",
      "own-budget",
      "deadline",
      "max-turns",
      "crash",
      "rate-limited",
      "harness-failure",
      "cancelled",
    ]);
  });
});

describe("ledger identity", () => {
  it("accepts the plan's run id and refuses lookalikes", () => {
    assert.match("20261002T101500-genex-claude-medieval-village-r1", RUN_ID_PATTERN);
    for (const bad of ["20261002-genex-claude-medieval-village-r1", "run-1", "20261002T101500-a-b-r", "/tmp/x"])
      assert.doesNotMatch(bad, RUN_ID_PATTERN);
  });

  it("tells a measurement from an unavailable or not-applicable pin", () => {
    assert.equal(isMeasured(12), true);
    assert.equal(isMeasured(null), true);
    assert.equal(isMeasured(unavailable(vocabulary.UnavailableReason.WindowReset)), false);
    assert.equal(isMeasured(NOT_APPLICABLE), false);
  });
});

describe("remote contract", () => {
  it("names well-formed API routes with one method each, split between ingest-key and anonymous surfaces", () => {
    const routes = Object.values(DesktopEvalRoute);
    for (const route of routes) {
      assert.match(route, /^\/api\/[A-Za-z/:-]+[a-z]$/, route);
      assert.ok(DESKTOP_EVAL_METHOD[route], `${route} has a method`);
    }
    assert.deepEqual([...EVALS_INGEST_ROUTES, ...ANONYMOUS_ROUTES].sort(), [...routes].sort());
    for (const route of EVALS_INGEST_ROUTES) assert.ok(route.startsWith("/api/evals/desktop/"), route);
    for (const route of ANONYMOUS_ROUTES) assert.ok(route.startsWith("/api/desktop/contributions"), route);
    assert.equal(DesktopEvalStatus.Gone, 410);
  });

  it("fills path parameters and escapes them", () => {
    assert.equal(
      gradesPath("20261002T101500-genex-claude-medieval-village-r1"),
      "/api/evals/desktop/runs/20261002T101500-genex-claude-medieval-village-r1/grades",
    );
    assert.equal(evidencePath("a/b"), "/api/evals/desktop/runs/a%2Fb/evidence");
    assert.equal(contributionPath("../x"), "/api/desktop/contributions/..%2Fx");
  });
});

describe("run sharing switch", () => {
  it("never asks by default, and stamps a dated consent version", () => {
    assert.equal(RUN_SHARING_ASK, RunSharingAsk.Never);
    assert.match(RUN_SHARING_CONSENT_VERSION, CONSENT_VERSION_PATTERN);
    assert.match("0123456789abcdef0123456789abcdef", INSTALL_ID_PATTERN);
    assert.doesNotMatch("user@example.test", INSTALL_ID_PATTERN);
  });
});

describe("eval CLI skeleton", () => {
  it("lists every command of the plan once and resolves multi-word commands", () => {
    const names = COMMANDS.map((spec) => spec.command);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(names, Object.values(vocabulary.EvalCommand));
    assert.equal(findCommand(["campaign", "plan", "--reps", "1"])?.spec.command, vocabulary.EvalCommand.CampaignPlan);
    assert.deepEqual(findCommand(["ledger", "share", "c1"])?.rest, ["c1"]);
    assert.equal(findCommand(["campaign"]), undefined);
  });

  it("hands every command to a handler, answers unknown with exit 64, and help with exit 0", async () => {
    const lines: string[] = [];
    const out = (line: string) => void lines.push(line);
    assert.ok(COMMANDS.every((spec) => typeof spec.run === "function"));
    assert.equal(await main(["report", "c1"], out), EXIT_USAGE);
    assert.equal(lines.at(-1), "usage: report <campaign> [--md | --html | --trend [--metric <metric>]]");
    assert.equal(await main(["explode"], out), EXIT_USAGE);
    assert.equal(await main(["--help"], out), 0);
    assert.ok(lines.some((line) => line.includes("validate-ledger")));
  });
});
