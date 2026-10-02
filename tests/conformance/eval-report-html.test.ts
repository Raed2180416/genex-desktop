/**
 * The static ledger explorer escapes everything it prints: hostile strings in any row field come
 * out as text, never as markup; the embedded data block cannot close its script element and parses
 * back to the same values; a missing measurement is null in the data and "not measured" on the
 * page, never zero. Hermetic: the page is rendered to a string and inspected; nothing is served.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { escapeHtml, jsonForScript } from "../../scripts/evals/report/html/escape.ts";
import { EXPLORER_SCRIPT } from "../../scripts/evals/report/html/client.ts";
import { explorerData, renderLedgerHtml } from "../../scripts/evals/report/html/render.ts";
import { MetricId } from "../../scripts/evals/report/endpoints.ts";
import { type RunRow, unavailable } from "../../scripts/evals/ledger/types.ts";
import { UnavailableReason } from "../../scripts/evals/vocabulary.ts";

const fixture = path.resolve(import.meta.dirname, "../fixtures/evals/report/run-row.json");
const baseRow = JSON.parse(fs.readFileSync(fixture, "utf8")) as RunRow;

const HOSTILE = [
  "</script><script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "'><svg onload=alert(1)>",
  "<!-- open comment",
  "`$" + "{alert(1)}`",
  "&lt;already-escaped&gt;",
  "line\u2028separator\u2029",
];

function hostileRow(text: string): RunRow {
  const row = structuredClone(baseRow);
  row.lane.id = text;
  row.case.id = text;
  row.campaignId = text;
  row.runId = text;
  return row;
}

function dataBlock(page: string): string {
  const match = /<script type="application\/json" id="ledger-data">([\s\S]*?)<\/script>/.exec(page);
  assert.ok(match, "the page has a data block");
  return match[1];
}

describe("escaping", () => {
  it("escapes every markup character in text and attribute values", () => {
    assert.equal(
      escapeHtml(`<a href="x" title='y'>&\`</a>`),
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;",
    );
    assert.equal(escapeHtml(null), "null");
  });

  it("writes JSON for a script element that parses back and holds no closing sequence", () => {
    for (const text of HOSTILE) {
      const json = jsonForScript({ text });
      assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
      assert.deepEqual(JSON.parse(json), { text });
    }
  });
});

describe("the explorer page", () => {
  it("renders hostile row fields as text: no injected element, and the data round-trips", () => {
    for (const text of HOSTILE) {
      const page = renderLedgerHtml({ rows: [hostileRow(text)], laneOrder: [], generatedAt: "2026-10-01T12:00:00Z" });
      assert.equal(page.match(/<script\b/g)?.length, 2, text);
      assert.equal(page.match(/<\/script>/g)?.length, 2, text);
      assert.doesNotMatch(page, /<img|<svg|<!--/, text);
      assert.ok(page.includes(escapeHtml(text)), `${text} appears escaped`);
      const data = JSON.parse(dataBlock(page));
      assert.equal(data.runs[0].laneId, text);
      assert.equal(data.runs[0].runId, text);
    }
  });

  it("keeps a missing measurement null in the data and prints it as words, never zero", () => {
    const row = structuredClone(baseRow);
    row.cost.apiEquivalentUsd = unavailable(UnavailableReason.PriceUnknown);
    row.time.wallMs = null;
    const data = explorerData([row]);
    assert.equal(data.runs[0].metrics[MetricId.ApiEquivalentUsd], null);
    assert.equal(data.runs[0].metrics[MetricId.WallMs], null);
    const page = renderLedgerHtml({ rows: [row], laneOrder: ["genex-claude"], generatedAt: "2026-10-01T12:00:00Z" });
    assert.match(page, /<td>not measured<\/td>/);
    assert.doesNotMatch(page, /\$0\.00/);
  });

  it("shows the latest campaign's scorecard first and marks raw lanes' app build as absent", () => {
    const earlier = structuredClone(baseRow);
    const later = structuredClone(baseRow);
    later.campaignId = "20261002T120000-later";
    later.recordedAt = "2026-10-02T12:00:00Z";
    later.pins.run.appSha = { na: true };
    const data = explorerData([later, earlier]);
    assert.equal(data.defaultCampaign, "20261002T120000-later");
    assert.deepEqual(
      data.runs.map((run) => run.appSha),
      [baseRow.pins.run.appSha, null],
    );
    const page = renderLedgerHtml({ rows: [earlier, later], laneOrder: [], generatedAt: "2026-10-01T12:00:00Z" });
    assert.equal(page.match(/<section data-campaign=/g)?.length, 2);
  });

  it("ships an in-page script that compiles", () => {
    assert.doesNotThrow(() => new Function(EXPLORER_SCRIPT));
  });
});
