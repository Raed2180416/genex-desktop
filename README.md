# Genex

A local macOS app for building three.js browser games with AI. Describe a game, review the
running preview, and keep the project as ordinary local files. Optional loops build and judge
candidate changes. Self-improvement is experimental, starts off, and can be enabled explicitly;
an automated verdict does not establish that a game improved.

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents start at
[AGENTS.md](AGENTS.md). Report security problems privately as described in
[SECURITY.md](SECURITY.md).

## Status and platforms

Genex is early. Signed, notarized macOS builds and Linux packages are published on
[GitHub Releases](https://github.com/genex-games/genex-desktop/releases); you can also run it
from source or package it yourself
([release readiness](docs/release-readiness.md#distribution-and-open-source)).
Installed macOS copies update themselves: a new version downloads in the background and the
sidebar offers **Relaunch to update**. Linux copies tell you about a new release (**Download
Genex X** in the sidebar); install the new `.deb` or `.rpm` over the old one. **Check for
Updates** is in Settings → About and the app menu.

| Platform | Status |
| --- | --- |
| macOS on Apple Silicon (arm64) | Supported: development, CI and packaging target |
| macOS on Intel (x64) | Untested; local models and native plugin runtimes need Apple Silicon |
| Linux (x64) | Preview: CI builds deb, rpm and zip packages and boots them on Ubuntu 22.04; window controls and Ubuntu 24.04's sandbox restriction are open |
| Windows 10/11 (x64) | Preview: CI builds an unsigned Squirrel installer, installs it and runs the packaged self test; needs Git for Windows and a one-time administrator approval for the sandbox |

License: [MIT](LICENSE), copyright `genex.games`.
[Third-party notices](THIRD-PARTY-NOTICES.md) list the included software and its terms.

## Set up

You need macOS on Apple Silicon, Git, and Node 24 (pinned in `.nvmrc`; nvm is the easy way to
get it). With nvm installed:

```bash
git clone https://github.com/genex-games/genex-desktop.git
cd genex-desktop
nvm install    # once; reads .nvmrc
nvm use        # in every new shell
npm ci
npm run check:static
npm run studio:dev -- start --profile contributor-first-run --fixture app-basics
```

The repository currently requires access. The fixture demonstrates the interface with scripted
models and synthetic games; it makes no provider calls. Stop it with
`npm run studio:dev -- stop --profile contributor-first-run`.

`npm ci` runs a postinstall check that refuses any Node other than 24, applies the repository's
patch to `@anthropic-ai/sandbox-runtime`, repairs node-pty's Unix helper execute bits, and runs
the pinned Electron to confirm it is present.
It does not look for provider CLIs or accounts. Run it again any time with
`npm run runtime:check`. Every npm script expects Node 24; a `.ts` script run under an older Node
fails with `ERR_UNKNOWN_FILE_EXTENSION`, so run `nvm use` first.

The embedded terminal uses node-pty's prebuilt macOS binary. After changing the Electron
version (or on Linux), run `npm run rebuild:terminal`.

`npm start` builds the app and opens your normal profile in
`~/Library/Application Support/Genex/`. For development without touching it, use an
isolated fixture profile: `npm run studio:dev -- start --profile <name> --fixture app-basics`
(see the [field guide](docs/STUDIO-DEVELOPER-FIELD-GUIDE.md)).

## Install

Once a release is published, its assets are on the
[GitHub releases page](https://github.com/genex-games/genex-desktop/releases), with a `SHA256SUMS`
file to check them against (`shasum -a 256 -c SHA256SUMS`).

- **macOS (Apple Silicon):** open `Genex.dmg` and drag Genex to Applications. The app is
  intended for Developer ID signing and notarization; verify the actual release before relying on this. macOS asks
  once before the app's agents work in your Documents, Desktop or Downloads folder.
- **Linux (x64, preview):** `sudo apt install ./genex_<version>_amd64.deb` or
  `sudo dnf install ./genex-<version>-1.x86_64.rpm`. Both pull in `bubblewrap`, `socat`
  and `ripgrep`, which the app needs to run agents in its sandbox.
- **Windows (x64, preview):** install [Git for Windows](https://gitforwindows.org), then run
  `Genex-<version> Setup.exe` (per user, no administrator rights). The installer is not signed
  yet, so SmartScreen warns first. On first launch **Set up** creates the sandbox's local
  `srt-sandbox` user and its network filter, with one administrator approval.

The app was called AI Game Studio. Its first launch as Genex moves that data folder to
`~/Library/Application Support/Genex/` (`~/.config/Genex` on Linux, `%APPDATA%\Genex` on Windows). Saved secrets are encrypted
under a key named after the app, so connect the Genex account and re-enter MCP connector secrets
once; Claude Code and Codex keep their own sign-ins.

## Build a release

Follow [release operations](docs/release-operations.md) for candidate identity, dependency
inventory, platform acceptance and recovery requirements.

To package for your own machine: `npm run package` (a folder in `out/`), or `npm run make` for the
installers (`out/make`: dmg and zip on macOS; deb, rpm and zip on Linux, which needs `rpm`
installed; a Squirrel `Setup.exe` on Windows). Run `npm run test:packaged` against the result. Without signing variables the macOS
build is ad-hoc signed and does not establish trusted distribution. Package from a checkout with its
own `node_modules`; a symlinked one is refused.

Signed releases come from [`.github/workflows/release.yml`](.github/workflows/release.yml): push a
`v<version>` tag matching `package.json` from `main` history (a version with `-` is a
pre-release), or dispatch on `main` with **publish** checked. Build-only dispatches on `dev`
produce unsigned candidates without signing access. Distribution needs a protected `release`
environment with these secrets:

| Secret | What it holds |
| --- | --- |
| `MACOS_CERT_P12` | The Developer ID Application certificate and its private key, as a base64 `.p12` |
| `MACOS_CERT_PASSWORD` | The `.p12` password |
| `APPLE_TEAM_ID` | The 10-character team id in the certificate's name |
| `APPLE_API_KEY` | The App Store Connect API key's `.p8` contents (role Developer), for notarization |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | That key's id and issuer id |
| `WINDOWS_CERT_PFX`, `WINDOWS_CERT_PASSWORD` | Windows signing certificate, base64 `.pfx`, and password; alternatively configure `WINDOWS_SIGN_PARAMS` for a provisioned signing service |

The workflow checks source/version eligibility and full regression before packaging. It signs
and notarizes macOS apps and DMGs, verifies macOS and Windows signatures, and smoke-tests all
three platform packages. Draft upload requires macOS signing; Windows packages join the draft
only once Windows signing is configured, and until then stay Actions artifacts. Assets include `SHA256SUMS`, a lockfile dependency inventory and platform provenance.
Published assets and drafts belonging to a different source are never replaced. Locally, `MACOS_SIGN_IDENTITY` (and `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`) sign and notarize the same way; see
[`scripts/package-signing.cjs`](scripts/package-signing.cjs).

## What needs an account or the network

Studio itself sends no analytics or crash reports. **Share build metrics** (Settings → Privacy)
is an opt-in, off by default, that sends anonymous numbers about finished builds. The
[desktop privacy policy](PRIVACY.md) describes it, storage, connected services and upload review. Provider and bundled CLI telemetry have
their own settings, described below. What each feature needs:

| Feature | Needs |
| --- | --- |
| Creating, opening, previewing, checking and exporting games | Nothing beyond a model below; exports are static web bundles |
| Local models | [Ollama](https://ollama.com) running on this Mac, or a Bonsai model downloaded in Settings (Apple Silicon) |
| Claude models | [Claude Code](https://code.claude.com/docs/en/setup), installed separately and signed in with a Claude subscription |
| ChatGPT/Codex models | The [Codex CLI](https://developers.openai.com/codex/cli/), installed separately; **Connect ChatGPT** signs in through your browser |
| Blender assets | Blender on this Mac, or one click downloads a pinned release from download.blender.org |
| Plugin catalog | Anonymous downloads from `plugins.genex.games` and GitHub |
| Genex asset generation, credits and hosted publishing | A Genex account (paid credits); publishing also needs `git-lfs` |

Studio finds Claude Code and Codex through a manual override, your login-shell `PATH`, then
standard locations, and shows the executable and version on each provider card. It never
automatically installs or updates them. Settings offers an explicit install/update action when
you choose it. Subscription limits apply; there is no automatic fallback to API-key
billing, and an ambient `ANTHROPIC_API_KEY` is not used. Codex keeps a Studio-specific login;
**Disconnect** uses Codex's own logout. Provider tokens never reach the renderer or the event log.
The coding CLIs follow their own vendors' telemetry settings. The bundled Genex CLI, both for
assets and as the Genex plugin's Blender tools, runs with its crash reporting off unless you set
`GENEX_TELEMETRY` yourself; `DO_NOT_TRACK` and `GENEX_DISABLE_SENTRY` are passed on to it.

## New projects and build previews

New projects start empty: a renderer and the studio inspection/capture contract, with no demo
player, pickups, floor, grid, lights, HUD, or movement logic. Material and foliage utilities
are available but are not loaded or instantiated by the empty entry point. Agents create game
content from the brief; score and player probes are required only for mechanics that exist.

A game you already have can be opened instead. The studio looks inside the folder first and
shows you what it found — what runs the game, what would stop a night, and every file opening it
would write — and nothing is written until you press the button on that sheet. A game with its
own build keeps it: the studio runs that build (never inside your folder — in a mirror of its
own) and serves the folder it produces.

A timed build (hours set in the composer) leaves the stage where you left it: Builds shows the
plan, the parts and their rounds when you open it, with saved builder frames alongside
provider/model and check status, and the game itself stays on Live until a merged build has been
confirmed to run. Rebuild and restart to load changed main code or shipped resources; the
harness's own edits survive upgrades.

## What makes it different

- **History is durable.** Append-only events and snapshots preserve messages and build evidence.
  Restart records interrupted work; the new harness reads that history rather than transparently
  continuing an in-memory process.
- **It rewrites its own code.** Tools, skills, prompts and the loop itself live in a git repo it
  can edit. A snapshot is taken before every self-edit; a version that cannot boot is rewound by a
  watchdog without a human.
- **The editable harness is contained.** Its child process runs inside ProcessSandbox with
  restricted writes and secret paths denied. Privileged model/provider work is mediated by the
  host and has separate vendor-account and sandbox boundaries.
- **It runs unattended.** Give it a goal and a reference game, walk away, and read the morning
  report: what it tried, what the blind judge said, what it rolled back, and what it changed about
  itself.
- **Assets come from local tools first.** Blender is the first: a builder writes a small script,
  the studio runs headless Blender in its own sandbox and drops a real mesh into the game's
  `assets/` folder. Hosted generation through the optional Genex plugin is opt-in and paid.
- **It runs on the subscription you already have.** Claude Code or Codex — the same chat, the same
  unattended night, the same three jobs (who plans, who builds, who judges) picked per model. Your
  subscription runs through the vendor's own harness and native account storage.
- **Nothing is trapped.** Games export as static web bundles you can host anywhere.

Unity integration has been removed. Its recoverable source and tests are preserved in
[archive/unity](archive/unity/README.md); there is no compatibility or migration layer.

## Documents

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, the test loop and how to send a change.
- [AGENTS.md](AGENTS.md) — rules for coding agents working in this repository.
- [Product overview](docs/agent/context.md) — what the app includes, with focused feature pages.
- [Developer field guide](docs/STUDIO-DEVELOPER-FIELD-GUIDE.md) — run commands and data locations.
- [Verification](docs/agent/verification.md) — test layers and which checks a change needs.
- [Evals](docs/evals.md) — the offline eval harness: lanes, grading, the eval ledger and campaigns.
- [Release readiness](docs/release-readiness.md) — what is still open before a public release.
