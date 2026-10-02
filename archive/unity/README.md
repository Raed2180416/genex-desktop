# Archived Unity integration

Removed from the active product on 2026-09-15 at the owner's request. This is source preservation, not a disabled feature or a supported plugin. Nothing in this directory is imported, built, seeded into the harness, or packaged.

## What is preserved

`integration.patch` contains the exact source, tests, fixtures, build wiring and current guidance changes between the pre-Unity commit `f5506c55f7d4e35e8641f98e584a11dcf1be6a52` and the reviewed snapshot `d8e7e398f64fd2433cb31ffb237064db91db569b`. `manifest.json` names all 206 files and the patch SHA-256. The actual integration commits are `6e7164e` and `3f68f35`; the intervening and subsequent handoff commits are historical context.

Includes CLI detection/download/sign-in, Pipeline transport and token gates, editor queue and process lifecycle, image capture, React stage/setup controls, shared and preload APIs, C# bridge, Unity game template, harness routing/evidence/judging, conformance fakes, and real-editor e2e runner. Original research and handoffs remain under `.claude/plans/unity-integration-*`.

Some unrelated changes were committed alongside Unity. The archive deliberately preserves the exact mixed snapshot. The active browser implementation retains the hours UI, early cancellation guard, provider-specific tool spelling, safe GPU-error handling, and timestamp-aware asset-still cache.

## Recover for research

Create a separate checkout at the recorded **base**, then apply this patch there:

```sh
git worktree add --detach /absolute/path/to/unity-research f5506c55f7d4e35e8641f98e584a11dcf1be6a52
cd /absolute/path/to/unity-research
git apply --check /absolute/path/to/ai-game-studio/archive/unity/integration.patch
git apply /absolute/path/to/ai-game-studio/archive/unity/integration.patch
```

Do not apply the patch directly to the current product. Reintroduction requires a new integration design and fresh editor/provider verification. Historical success reports do not certify today's Unity versions.

Restoration was actually checked in a disposable export of the base: the patch applied, and all 206 reconstructed files matched the original snapshot byte-for-byte. See `.claude/plans/repo-review-evidence/archive-check.json`.

## Existing installations

Unity-specific compatibility guards are intentionally absent. Ordinary browser-project validation remains. Existing games, account data and user-edited harness files are preserved; fresh profiles receive the browser harness. The archive is excluded from packaged applications.
