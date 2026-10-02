/**
 * Settings → Model Providers: a connected row says nothing about its model list while the list is
 * fine, and speaks up only to say it is still loading or that a refresh failed (with Try again).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CatalogNoteKind, catalogNote } from "../../src/renderer/panels/catalog-note.ts";
import { ModelCatalogProblemCode, ModelCatalogSource, ModelCatalogState } from "../../src/shared/model-catalog.ts";

const ready = {
  state: ModelCatalogState.Ready,
  revision: 3,
  refreshing: false,
  source: ModelCatalogSource.Provider,
  refreshedAt: 1,
};
const timeout = { code: ModelCatalogProblemCode.Timeout, message: "Model discovery timed out. Try again." };

describe("catalog note", () => {
  it("stays silent while the list is fine or a refresh is quietly under way", () => {
    assert.equal(catalogNote(undefined), null, "a provider without a catalog");
    assert.equal(catalogNote(ready), null, "up to date: no freshness line, no Refresh or Update buttons");
    assert.equal(catalogNote({ ...ready, refreshing: true }), null, "a background refresh answers for itself");
    assert.equal(
      catalogNote({ ...ready, state: ModelCatalogState.Stale, source: ModelCatalogSource.Cache }),
      null,
      "saved models with nothing failed are still the right list",
    );
  });

  it("says the list is loading before the first one arrives", () => {
    const note = catalogNote({ state: ModelCatalogState.Loading, revision: 0, refreshing: true });
    assert.equal(note?.kind, CatalogNoteKind.Loading);
    assert.equal(note?.retry, false);
  });

  it("offers Try again after a failed refresh, keeping the provider's reason as detail", () => {
    const stale = catalogNote({ ...ready, state: ModelCatalogState.Stale, problem: timeout });
    assert.equal(stale?.kind, CatalogNoteKind.Problem);
    assert.equal(stale?.retry, true);
    assert.equal(stale?.retrying, false);
    assert.equal(stale?.detail, timeout.message);
    const unavailable = catalogNote({ state: ModelCatalogState.Unavailable, revision: 1, refreshing: false });
    assert.equal(unavailable?.kind, CatalogNoteKind.Problem);
    assert.notEqual(unavailable?.text, stale?.text, "no saved models to show: a different sentence");
  });

  it("keeps the failure in place while its retry runs", () => {
    const note = catalogNote({ ...ready, state: ModelCatalogState.Stale, problem: timeout, refreshing: true });
    assert.equal(note?.kind, CatalogNoteKind.Problem);
    assert.equal(note?.retrying, true);
  });
});
