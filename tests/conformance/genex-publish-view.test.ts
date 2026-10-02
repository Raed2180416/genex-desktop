import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PublishGate,
  publishGate,
  publishSteps,
  publishView,
  studioPublishButton,
} from "../../src/renderer/panels/plugins/genex/genex-publish-view.ts";
import {
  GENEX_PLUGIN_ID,
  GENEX_PUBLISH_PANEL,
  type GenexPublishJob,
  type GenexPublishState,
} from "../../src/shared/genex.ts";
import type { PluginInfo } from "../../src/shared/plugins.ts";

const state = (over: Partial<GenexPublishState> = {}): GenexPublishState => ({
  version: 1,
  project: "game",
  connected: true,
  ...over,
});
const job = (over: Partial<GenexPublishJob> = {}): GenexPublishJob => ({
  id: "j1",
  kind: "gallery",
  state: "running",
  phase: "exporting",
  startedAt: "2026-09-30T10:00:00Z",
  ...over,
});

test("the dialog names where the game is and offers one press from there", () => {
  const none = publishView(state());
  assert.equal(none.stage, "none");
  assert.equal(none.primary.label, "Publish");
  assert.equal(none.primary.ariaLabel, "Publish this game on Genex", "the smoke selector stays");
  assert.equal(none.canPublish, true);
  assert.ok(!("secondary" in none), "a draft is no second button beside Publish");

  const draft = publishView(state({ slug: "my-game", status: "draft", draftUrl: "https://x/draft" }));
  assert.equal(draft.stage, "draft");
  assert.equal(draft.primary.label, "Publish");

  const live = publishView(state({ slug: "my-game", status: "published", galleryUrl: "https://x/g" }));
  assert.equal(live.stage, "public");
  assert.equal(live.primary.label, "Publish update");

  const signedOut = publishView(state({ connected: false }));
  assert.equal(signedOut.canPublish, false);
  assert.deepEqual(signedOut.problems, [], "Connect Genex is offered in its place, not reported as a problem");
});

test("Publish asks for what is missing in order: Genex installed, turned on, then an account", () => {
  assert.equal(publishGate(undefined, undefined), PublishGate.Install);
  assert.equal(publishGate({ enabled: false, removed: true }, undefined), PublishGate.Install);
  assert.equal(publishGate({ enabled: false, removed: false }, undefined), PublishGate.TurnOn);
  assert.equal(publishGate({ enabled: true, removed: false }, false), PublishGate.Connect);
  assert.equal(publishGate({ enabled: true, removed: false }, true), PublishGate.Ready);
  assert.equal(
    publishGate({ enabled: true, removed: false }, undefined),
    PublishGate.Ready,
    "unread yet is not asked for",
  );
});

const genex = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  manifest: {
    apiVersion: 3,
    id: GENEX_PLUGIN_ID,
    version: "1.0.0",
    name: "Genex Tools",
    publisher: "Genex",
    description: "t",
    backend: "backend.mjs",
    capabilities: [],
    tools: [],
    skills: [],
    panels: [{ id: GENEX_PUBLISH_PANEL, title: "Publish", file: "publish.html", placement: "project" }],
    settings: [],
    actions: [],
    toolbar: [
      {
        id: "publish",
        label: "Publish",
        ariaLabel: "Publish game",
        target: { kind: "panel", id: GENEX_PUBLISH_PANEL },
      },
    ],
  },
  source: "bundled",
  enabled: true,
  removed: false,
  health: "stopped",
  state: "enabled",
  ...over,
});

test("every open game has Publish on its stage strip, whether Genex is on, off, removed or missing", () => {
  assert.equal(studioPublishButton([genex()], "game"), false, "Genex's own button is the one shown");
  assert.equal(studioPublishButton([genex({ enabled: false, state: "disabled" })], "game"), true);
  assert.equal(studioPublishButton([genex({ enabled: false, removed: true, state: "disabled" })], "game"), true);
  assert.equal(studioPublishButton([], "game"), true);
  assert.equal(studioPublishButton([], null), false, "with no game open there is nothing to publish");
});

test("a running attempt shows its steps: a first publish lists once, a listed game updates and promotes", () => {
  const first = job({ phase: "creating-project" });
  assert.deepEqual(publishSteps(first, state()), ["export", "create", "list"]);
  const listed = state({ slug: "g", status: "published" });
  assert.deepEqual(publishSteps(job({ phase: "uploading" }), listed), ["export", "upload", "public"]);
  assert.deepEqual(publishSteps(job({ kind: "draft", phase: "uploading" }), listed), ["export", "upload", "check"]);

  const view = publishView(state({ slug: "g", status: "published", job: job({ phase: "promoting" }) }));
  assert.equal(view.running, true);
  assert.equal(view.canPublish, false, "nothing else starts while one runs");
  assert.equal(view.phase, "Making it the public version");
  assert.deepEqual(
    view.steps.map((s) => [s.step, s.state]),
    [
      ["export", "done"],
      ["upload", "done"],
      ["public", "current"],
    ],
  );
});

test("an upload whose outcome is unknown offers Check again and the person's own word, never a silent retry", () => {
  const unknown = publishView(
    state({ slug: "g", job: job({ state: "unresolved", phase: "unresolved", kind: "draft" }) }),
  );
  assert.equal(unknown.running, false);
  assert.equal(unknown.unresolved, true);
  assert.deepEqual(
    unknown.extra.map((b) => [b.label, b.action]),
    [
      ["Check again", "publish-status"],
      ["I checked — allow a new upload", "publish-allow-upload"],
    ],
  );
  assert.equal(unknown.canPublish, false);
  assert.ok(unknown.notes.some((n) => /couldn’t tell whether the upload reached Genex/.test(n)));

  const failed = publishView(state({ job: job({ state: "failed", phase: "failed", error: "It broke." }) }));
  assert.deepEqual(failed.problems, ["It broke."]);
  assert.equal(failed.canPublish, true, "a failed attempt can be tried again");

  const terms = publishView(state({ terms: { accepted: false, acceptUrl: "https://x/terms" } }));
  assert.deepEqual(
    terms.extra.map((b) => b.action),
    ["terms"],
  );
});
