/**
 * The scorecard as HTML: the same cells as the Markdown scorecard (`laneCells`), one section per
 * campaign so the explorer can show the campaign its filter picks. Every value is escaped.
 */
import { caseHeading, laneCells, SCORECARD_COLUMNS, type Scorecard, scorecardFooter } from "../scorecard.ts";
import { escapeHtml } from "./escape.ts";

/** One campaign's scorecard as an HTML section, tagged with its campaign id. */
export function renderScorecardHtml(scorecard: Scorecard): string {
  const head = `<tr>${SCORECARD_COLUMNS.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr>`;
  const cases = scorecard.cases.map((card) => {
    const rows = card.lanes
      .map(
        (lane) =>
          `<tr>${laneCells(lane)
            .map((text) => `<td>${escapeHtml(text)}</td>`)
            .join("")}</tr>`,
      )
      .join("\n");
    return `<h3>${escapeHtml(caseHeading(card))}</h3>\n<div class="table-wrap"><table><thead>${head}</thead><tbody>\n${rows}\n</tbody></table></div>`;
  });
  return [
    `<section data-campaign="${escapeHtml(scorecard.campaignId)}">`,
    `<p class="note">Campaign ${escapeHtml(scorecard.campaignId)}</p>`,
    ...cases,
    `<p class="note">${escapeHtml(scorecardFooter(scorecard))}</p>`,
    "</section>",
  ].join("\n");
}
