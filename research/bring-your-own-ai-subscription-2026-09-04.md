# Bringing an AI subscription to an autonomous game studio

Research date: 4 September 2026. Findings reflect the documentation available on that date and the source snapshots listed at the end. This is source and documentation research, not a test of paid accounts or sustained production concurrency. Repository HEAD can include changes not yet in a released build. The supplied brief ended mid-sentence; the final question is treated as asking what the product can promise about unattended execution.

**The important product distinction is between hosting somebody else's agent and accessing somebody else's model.** A Claude or ChatGPT subscription is not a general API wallet. Nevertheless, supported ways to use subscriptions inside third-party products exist. Some preserve the vendor's executable, authentication and agent loop; others expose an expressly supported OAuth integration; community tools sometimes reconstruct access to subscription endpoints themselves. These approaches can look identical in an account picker while having very different operational and contractual properties.

For this studio, keep two execution paths available: native agents for supported subscription integrations, and a studio-owned agent loop for API keys and local models. Your scheduler, worktrees, screenshots, checkpoints and task graph can span both. Treat direct subscription adapters as a separate, provider-specific decision. The analysis below explains the alternatives rather than assuming one universal solution.

**The designs already in use**

| Design | Who runs the agent loop? | Credential custody | Onboarding | Main tradeoff |
|---|---|---|---|---|
| Host a vendor agent | Claude Code, Codex, Grok Build, Copilot CLI, Cursor or Gemini CLI | Vendor runtime's local store; host can usually access it under the same OS identity | Product installs/downloads runtime and launches its browser/device login | Retains native capabilities; each runtime has different controls and terms |
| Implement direct subscription access | Hermes, OpenCode, Pi, OMP or a plugin | Third-party process stores and refreshes provider tokens | Browser OAuth/device code, sometimes import of an existing login | Full loop control; endpoint compatibility and commercial authorization need separate answers |
| Use a documented application OAuth integration | For example, Copilot SDK with an application's GitHub OAuth integration | Application owns per-user token storage unless using CLI-managed login | Register your application; user authorizes it in browser | Clearer multi-user design, but the product becomes a credential custodian |
| Bring an API key | Studio loop or compatible native agent | Ideally OS credential store locally; server secret store for cloud execution | Paste key or supported provider authorization flow; separate API billing | Broad commercial integration route and explicit budgets; consumer plan usually does not pay |
| Buy access through a gateway | Studio or gateway agent | Gateway holds upstream credentials; customer holds a gateway credential | Gateway account/payment, or studio-funded credits | Convenient model choice; introduces another bill and data processor |
| Run a local model | Studio loop | No provider token for a local unauthenticated runtime | Install runtime, download model, check hardware | No remote quota, but model quality, memory and throughput become the constraints |

“The app never handles tokens” is a useful description of deliberate custody. It is not a strong isolation claim. A CLI child process running as the user is normally accessible to the parent and other sufficiently privileged processes. File permissions restrict other users; they do not isolate cooperating processes running as the same user. Keychain access is stronger storage protection, but the authorized runtime must still obtain a usable secret.

This matters especially when workers execute generated code and package scripts. Keep the credential-owning process outside the build/render sandbox where practical, and avoid mounting provider auth directories into it. A separate worktree alone does not protect the user's home-directory secrets.

**What the requested projects actually do**

| Project | Product/account context | Source-observed integration | Credential location and access |
|---|---|---|---|
| Hermes | Open-source, locally operated/self-hosted agent; optional commercial Nous Portal account | Runs its own loop. Has direct Codex and xAI OAuth adapters; its Anthropic path can read native Claude credentials or use its own OAuth store | `~/.hermes/auth.json`, provider-specific files and optional credential pools. File locking and restrictive permissions, not an OS vault. Hermes and its extensions can read usable tokens |
| OpenCode | Open-source CLI/desktop/server product; optional paid Zen/Go services | Own loop. Built-in Codex plugin signs in and calls the ChatGPT Codex backend directly; it does not invoke `codex exec` | Default data directory `~/.local/share/opencode/auth.json`, mode 0600. The process and loaded plugins have access. A remote OpenCode server moves this custody to the server |
| Pi / pi-mono | Open-source agent and embeddable libraries | Own loop and provider transports, including subscription adapters. Programmatic sessions support images, events and persistence | CLI uses `~/.pi/agent/auth.json`; locking coordinates writes. Library credential storage is injectable, allowing a different backend in your product |
| OMP / oh-my-pi | OMP is the executable for this Pi fork, not an independent fifth design | Own loop, extensive auth/usage handling, optional broker and inference gateway | Current default is `~/.omp/agent/agent.db`. Credentials are serialized in SQLite; 0600 is not database encryption. Broker mode changes who holds the secrets |
| OpenCode community Codex auth plugin | Community integration explicitly framed around personal use | Rewrites requests to subscription endpoints, refreshes OAuth, adapts request/tool behavior | OpenCode auth storage; plugin code has access to the bearer and refresh flow |

These descriptions come from implementation files, not just provider lists: [Hermes auth store](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/hermes_cli/auth.py), [OpenCode auth store](https://github.com/anomalyco/opencode/blob/5cf9f517cfec3ef68d3e68a12a6a4b3163947f44/packages/opencode/src/auth/index.ts), [Pi auth storage](https://github.com/earendil-works/pi-mono/blob/92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c/packages/coding-agent/src/core/auth-storage.ts), [OMP SQLite store](https://github.com/can1357/oh-my-pi/blob/5964a0f7649275bcde818f20073193fd032451f2/packages/ai/src/auth/sqlite-credential-store.ts), [community plugin request adapter](https://github.com/numman-ali/opencode-openai-codex-auth/blob/bec2ad69b252ef4ad7dd33b9532ff8b4fdb6d016/lib/request/fetch-helpers.ts).

Hermes makes a revealing choice for Codex: it maintains its own OAuth session rather than continually sharing the native CLI's refresh token, specifically to avoid refresh rotation invalidating the other application. It still supports legacy credential import. That is an operational improvement, not evidence of a general commercial license. Its Anthropic adapter reads Claude's credential file or macOS Keychain and makes requests itself with compatibility headers and transformations. Thus “uses your Claude login” does not mean “runs Claude Code.” [Codex credential implementation](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/hermes_cli/auth_codex.py), [Anthropic credential discovery](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/agent/anthropic_credentials.py), [Anthropic adapter](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/agent/anthropic_adapter.py).

OpenCode's native Codex plugin implements browser PKCE and device login, uses a fixed OAuth client identifier, refreshes tokens, and sends inference to `chatgpt.com/backend-api/codex/responses`. Pi similarly has a dedicated Codex Responses transport, including reasoning options and connection/session handling. These are substantial provider-specific adapters beneath the apparent uniform model API. Do not estimate the work as replacing an API base URL. [OpenCode implementation](https://github.com/anomalyco/opencode/blob/5cf9f517cfec3ef68d3e68a12a6a4b3163947f44/packages/opencode/src/plugin/openai/codex.ts), [Pi Codex transport](https://github.com/earendil-works/pi-mono/blob/92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c/packages/ai/src/api/openai-codex-responses.ts).

OMP's cloud-related architecture is particularly instructive. Its broker holds the canonical credentials and performs refresh. Broker snapshots redact refresh tokens but still contain usable access tokens. The separate inference gateway keeps those access tokens away from downstream gateway clients by making provider calls itself. “Broker client” and “gateway client” therefore have different trust levels. The documented bearer-protected, operator-secured deployment is useful infrastructure, not a complete tenant isolation or subscription licensing solution. [Broker and gateway design](https://github.com/can1357/oh-my-pi/blob/5964a0f7649275bcde818f20073193fd032451f2/docs/auth-broker-gateway.md).

The projects also demonstrate documentation drift. Hermes currently describes restrictions on its direct Anthropic OAuth path; Pi describes extra-credit behavior; OpenCode's providers page both retains subscription-oriented instructions and says bundled Anthropic OAuth support was removed in 1.3.0. Those are implementation/support statements, not substitutes for Anthropic's current policy. [Hermes providers](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/website/docs/integrations/providers.md), [Pi providers](https://github.com/earendil-works/pi-mono/blob/92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c/packages/coding-agent/docs/providers.md), [OpenCode providers](https://opencode.ai/docs/providers/).

**Commercial products offer better precedents than personal auth plugins**

Zed's external-agent architecture is a close match for your desktop transition. Its ACP registry can install agents in the product, while the external agent retains its own authentication, runtime and billing. Users need not independently discover and install a CLI first. Zed's Claude adapter source resolves the SDK's packaged native executable and invokes native authentication; the adapter uses the Agent SDK for execution. This demonstrates the packaging and UI pattern, but does not establish which commercial permissions another integrator has. [Zed external agents](https://zed.dev/docs/ai/external-agents), [Zed Claude adapter source](https://github.com/zed-industries/claude-agent-acp/blob/f74a51758dc42896addbcdaf7611a29ec1d1db17/src/acp-agent.ts).

JetBrains explicitly supports signing Codex into a ChatGPT account inside its commercial IDE product, alongside JetBrains AI and API-key alternatives. JetBrains Air is even closer to your task model: users select an agent/model per task. Its current agent table lists ChatGPT subscription and OpenAI API options for Codex, but an Anthropic API account for its Claude Agent. Air's introductory prose mentions Claude subscriptions more broadly, so the table is the more precise evidence. Air also restricts cloud/web tasks to organization-enabled providers rather than carrying arbitrary local BYO accounts into the cloud. [Codex in JetBrains](https://www.jetbrains.com/help/ai-assistant/codex-agent.html), [Air supported agents](https://www.jetbrains.com/help/air/supported-agents.html).

xAI itself announces Grok subscription integrations with Hermes and OpenCode, and with commercial products Kilo Code and Warp. This is stronger evidence than a plugin author saying an endpoint works. Kilo's announcement specifically includes browser login and remote environments. The announcements do not disclose the full credential custody of closed-source products or grant your application its own OAuth client registration. [Hermes endorsement](https://x.ai/news/grok-hermes), [OpenCode endorsement](https://x.ai/news/grok-opencode), [Kilo Code endorsement](https://x.ai/news/grok-kilocode), [Warp endorsement](https://x.ai/news/grok-warp).

GitHub goes further in publicly documenting the integration contract: Copilot SDK has application OAuth, per-user tokens, multi-user server guidance and billing against the authenticated user's entitlement. This is a serious candidate, even if it was not in your original architecture. The Node, Python and .NET SDK setup supplies the CLI automatically; language/runtime packaging still needs attention. [Copilot authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate), [application OAuth setup](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth), [SDK setup](https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started).

Paid gateway accounts solve a different problem. For example, Nous Portal offers its own paid access used by Hermes; it does not convert an existing Claude subscription into a transferable provider balance. Decide whether your product is bringing the user's existing entitlement, bringing a separate API billing relationship, or selling a new service. Label these separately. [Nous Portal integration](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/website/docs/integrations/nous-portal.md).

**What the provider policies support**

Anthropic's current Claude Code guidance expressly permits hosting the unmodified binary, including in products and hosted sandboxes, under its Commercial Terms. Built-in sign-in methods must remain available; each end user authenticates and pays directly. The same page forbids offering your own Claude.ai login, collecting session tokens or routing subscription credentials yourself, with an explicit exception for users signing into hosted, unmodified Claude Code. This supports a native-hosting design, not a general subscription-token adapter. [Claude Code legal guidance](https://code.claude.com/docs/en/legal-and-compliance).

The Agent SDK overview separately says third-party products may not offer Claude.ai login/rate limits without prior approval. Your existing SDK-based product sits at that documentation boundary. Confirm how your exact packaging, native login and unattended SDK execution fit the hosting provision before marketing Claude subscription support; API authentication has a much clearer SDK path. [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview).

Do not confuse billing behavior with permission. Anthropic's June 15 update paused its proposed separate Agent SDK credit scheme: the current notice says SDK, `claude -p` and third-party app usage still draw from subscription limits. The historical monthly-credit table lower on that page is explicitly not taking effect. That notice does not override the product authentication restrictions. [Current billing notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

Anthropic's consumer terms restrict automated access subject to stated exceptions and prohibit various forms of resale; its commercial terms provide for APIs powering customer applications. Selling a game studio, selling generated games and reselling access to an Anthropic account are different activities. A paid studio account alone does not decide the authentication question. [Consumer terms](https://www.anthropic.com/legal/consumer-terms), [Commercial terms](https://www.anthropic.com/legal/commercial-terms).

OpenAI explicitly positions Codex as a platform for embedding its agent in products, with App Server for product integrations, SDKs and command-line automation. Combined with ChatGPT authentication documentation and commercial IDE precedents, this makes a native Codex integration a strong option. I did not find a general public grant allowing any new product to reuse Codex's OAuth client identity and provide its own multi-user subscription inference proxy. Those are different proposals. [Codex platform announcement](https://learn.chatgpt.com/blog/codex-as-a-platform).

OpenAI's terms restrict sharing accounts, making them available to others, resale and bypassing limits. They should be read alongside the expressly documented Codex integration surfaces, not interpreted as forbidding all Codex automation. One customer's personal runtime is different from pooling customers' subscriptions into a service. For a cloud subscription product or a custom OAuth client, obtain a provider-specific answer rather than assuming an IDE precedent covers every design. [OpenAI terms](https://openai.com/policies/terms-of-use/).

xAI is unusually explicit in encouraging subscription use through named third-party harnesses. Its consumer terms still bind the individual account and distinguish developer/business API arrangements. Its enterprise terms allow distributing applications built around the API as bundled services. The unresolved issue for your own subscription integration is registration and commercial scope, not whether third-party Grok access exists. Ask for the supported client-registration route, eligible plans, endpoints, cloud permissions and revocation/limit contract. [Consumer terms](https://x.ai/legal/terms-of-service), [Enterprise terms](https://x.ai/legal/terms-of-service-enterprise).

| Additional provider | Most defensible route found | Boundary |
|---|---|---|
| GitHub Copilot | Official SDK with native login or your registered application and per-user auth | Server docs exist, but organization policies, model eligibility, billing and tenant isolation still apply |
| Cursor | Native `agent acp` and its own browser authentication; documented automation auth options | OMP's direct Cursor OAuth/API adapter is a separate implementation, not proof of permission for arbitrary Cursor backend clients |
| Gemini | Host the native Gemini CLI/ACP where applicable, or use Gemini API/Vertex credentials | Gemini explicitly says third-party harnesses directly accessing its backend with Gemini CLI OAuth violate its terms |

Sources: [Copilot multi-user deployment](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/multi-tenancy), [Cursor ACP](https://cursor.com/docs/cli/acp), [Cursor authentication](https://cursor.com/docs/cli/reference/authentication), [OMP Cursor adapter](https://github.com/can1357/oh-my-pi/blob/5964a0f7649275bcde818f20073193fd032451f2/packages/ai/src/registry/oauth/cursor.ts), [Gemini CLI terms explanation](https://geminicli.com/docs/resources/tos-privacy/).

The community plugin's “personal use” warning is best understood as a limit on what its maintainer is asserting. It is neither a vendor license nor a statement that all commercial output is forbidden. The Codex auth plugin explicitly redirects production/multi-user applications toward the API. An MIT/Apache license grants rights in the integration's code, not rights to a provider's subscription service, OAuth identity or private endpoints. Browser PKCE proves possession and consent within a flow; it does not establish that the flow is approved for your product. Some Antigravity plugins go further and explicitly warn of terms violations and account bans. [Codex plugin disclaimer](https://github.com/numman-ali/opencode-openai-codex-auth/blob/bec2ad69b252ef4ad7dd33b9532ff8b4fdb6d016/README.md), [Antigravity plugin warning](https://github.com/NoeFabris/opencode-antigravity-auth).

**Onboarding can be graphical without inventing a login protocol**

The user should first sign into the studio, then connect a runtime/account on this device. Those are separate identities. A studio login should synchronize preferences and project metadata; it need not synchronize provider secrets. “Connected on this Mac” is more accurate than implying that one connection works on every device and in cloud jobs.

For native runtimes, install or download a pinned, verified vendor distribution into an application-managed location, subject to its distribution terms. Expose native browser/device login in the UI. Keep the provider's required alternatives accessible. Let the runtime store and refresh its credentials, and have the app consume status rather than credential contents. Runtime updates and login repairs become product responsibilities; eliminating the terminal does not eliminate the runtime.

| Runtime | Native login and credential observations | Product consequence |
|---|---|---|
| Codex | Browser/device authentication; file or OS credential-store configuration. `auto` can fall back to a file | Choose storage deliberately; isolate the studio's runtime configuration if appropriate; surface actual account/billing mode |
| Claude Code | macOS Keychain; documented credential-file fallback when unavailable, and file storage on Linux. Config-directory changes affect the store identity | A native sign-in does not mean every platform has an encrypted vault; avoid copying these tokens into studio storage |
| Grok Build | Native browser or device login, external auth command and API-key alternatives | Offers both desktop and headless building blocks; distinguish native subscription login from API billing |
| Copilot SDK | Can use CLI-managed login or explicit per-user application tokens | Decide consciously whether the runtime or your application owns tokens; disable ambient logged-in-user fallback when selecting an explicit user |
| Cursor | Browser login, including a printed URL for environments without automatic browser opening | Wrap the native flow; do not infer an exact storage backend from a general claim of secure local storage |

Sources: [Codex auth](https://learn.chatgpt.com/docs/auth), [Claude auth](https://code.claude.com/docs/en/authentication), [Grok Build enterprise/auth](https://docs.x.ai/build/enterprise), [Copilot auth](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate), [Cursor auth](https://cursor.com/docs/cli/reference/authentication).

Codex App Server provides managed login start/completion events, account status, thread/turn operations and streamed approvals. Its model catalog exposes image modalities and supported reasoning efforts. It is a better product integration surface than treating `codex exec` output as the entire API. Its externally managed ChatGPT-token mode should not be mistaken for permission to invent a third-party OAuth flow. [App Server protocol](https://learn.chatgpt.com/docs/app-server).

After connection, run a small, disclosed capability check: verify inference entitlement, a tool call, image understanding for critics, workspace access and the selected effort option. Login success alone is insufficient. Hermes documents xAI cases where OAuth succeeds but inference returns 403 despite an active subscription; the vendor's broad availability announcement and a concrete account's entitlement can diverge. [Hermes xAI guide](https://github.com/NousResearch/hermes-agent/blob/96e1e3f9219e56d16641c447e62adfbb0ea067ec/website/docs/guides/xai-grok-oauth.md).

For API keys, use the OS credential store and give each worker only the credential it needs. For a local runtime, guide the user through model download and benchmark the actual device. Ollama supports tool calling, but model support and available memory determine whether concurrent sessions work well; queue overload can return 503. The GPU also competes with rendering and other local work. A local model should earn eligibility for a screenshot critic through a vision test. [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling), [Ollama resource/concurrency guidance](https://docs.ollama.com/faq).

**How much abstraction is realistic**

The following is an architecture recommendation inferred from the source and protocol differences, not a claim that any vendor supplies this complete interface.

Normalize work at the boundary of a task. A task should specify its role, workspace, input artifacts, permitted actions, model/effort preference, stop conditions and budget. Its result should include status, changed files, checkpoints, artifact references, usage observations and a typed reason if it cannot continue. Keep the native session ID and provider-specific details alongside this common record.

| Concern | Useful common contract | What must remain adapter-specific |
|---|---|---|
| Planning and edits | Start/continue/interrupt task; report changed files and artifacts | Native tool loop, compaction, edit mechanisms, instructions and system prompts |
| Vision | Submit image artifact; require an eligible model/transport | Image formats, resolution limits, token cost and whether the image actually reached the model |
| Reasoning | User preference plus the exact selected native setting | Available levels, token budgets, defaults and model-specific constraints |
| Permissions | Workspace boundaries, network policy, user-action event | Vendor approval protocol and sandbox guarantees; MCP is not a sandbox |
| Session recovery | Durable studio checkpoint plus optional native resume token | Transcript format, native session storage, version compatibility and compaction state |
| Concurrency | Separate task/session/worktree; scheduler limits by account and model | Runtime process safety, token refresh coordination and provider admission limits |
| Usage | Timestamped observations with source and units | Account meters, token charges, included credits, model multipliers and missing data |

Do not force every runtime through a single `messages[] -> response` interface. That works for direct inference but discards the main value of native agents. Conversely, do not force a studio-owned loop to imitate every native CLI event. ACP is useful for editor-to-agent interoperability; it does not make billing, sandboxing, native tool behavior or session persistence interchangeable. Grok's own CLI explicitly offers headless streaming and ACP integration modes. [Grok Build overview](https://docs.x.ai/build/overview).

Pi provides reusable session and inference building blocks if you want to own the loop; its SDK supports image prompts and programmatic session control. Use those with API/local providers independently of deciding whether to ship each OAuth adapter. Owning the loop also means owning compaction, recovery, tool validation, provider-specific reasoning payloads and evaluation. [Pi SDK](https://github.com/earendil-works/pi-mono/blob/92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c/packages/coding-agent/docs/sdk.md), [injectable credential store](https://github.com/earendil-works/pi-mono/blob/92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c/packages/ai/src/auth/credential-store.ts).

For your roles, a practical split is native agents for workers that benefit from their coding tools, and direct API/local inference for tightly controlled planning or screenshot evaluation. It remains legitimate to use native agents for all roles when their controls suffice. Enforce a critic's read-only role with actual capabilities and filesystem isolation, not merely a prompt. Keep screenshot rendering in a studio-controlled tool so every critic evaluates the same artifact.

Per-role mixing is feasible at task boundaries. A new provider can continue from a written brief, commits, tests and screenshots, but it cannot inherit another provider's hidden reasoning or native session state. Call that a handoff or restarted task, not a seamless resume.

Store selections as a connection plus runtime, billing source, model, native effort and execution location. “Claude” alone is ambiguous: it could mean Claude Code subscription usage, an Anthropic API key, or a model served through Copilot or another gateway. The latter inherits that intermediary's entitlements and controls.

**Concurrency and unattended runs require admission control**

Three distinct things are often called parallelism: several tool calls in one turn, subagents within one vendor session, and independent model sessions doing work simultaneously. Your worktree architecture requires the third. An advertised parallel-tool option is not evidence of independent worker throughput.

Launch separate sessions for workers and serialize mutations to each session. Coordinate refresh through a single authority or a proven cross-process store; never let every worker independently rotate a copied refresh token. Share account-limit observations across orchestrator, workers and critics. Worktrees isolate edits, not account quotas, RAM, build caches, ports or GPU memory.

Ramp concurrency based on observed admission and latency rather than a universal “N workers per subscription.” Keep capacity for criticism, merging and recovery. If all quota is consumed producing drafts, the product cannot finish its own review cycle. Do not respond to limits by rotating through pooled customer accounts or concealing identity.

| Provider/runtime | Useful limit signal | Honest treatment |
|---|---|---|
| Claude | SDK rate-limit events distinguish warnings/rejection, reset times and five-hour/seven-day/model/overage categories; native usage views can be cached | Report the relevant bucket and freshness. Model-list-price cost is not the subscriber's bill |
| Codex | App Server account limit reads/updates expose multiple limit IDs, used percentage, reset timestamps and optional credit information | Preserve all buckets. Unknown fields are unavailable, not unlimited |
| Grok subscription | OMP has adapters for both older weekly-credit data and newer monthly included/on-demand billing data | No universal weekly cap should be hard-coded; validate the account's actual entitlement/meter |
| xAI API | Per-team/model request and token limits; 429 responses | These API limits are distinct from Grok subscription limits |
| Copilot | Account quota RPC and session usage/billing metrics; model pricing metadata | Units and model costs matter. Per-event usage is not replayed on session resume |
| Gemini CLI | Personal/Code Assist allowances depend on account and can be shared with related products | Separate CLI entitlement from Gemini API or Vertex limits |
| Local inference | Memory pressure, queue length, runtime errors and throughput | Queue/slow down; no invented subscription-style quota bar |

Sources: installed Claude SDK 0.3.257 rate-limit types (`@anthropic-ai/claude-agent-sdk/sdk.d.ts`), [Claude usage/costs](https://code.claude.com/docs/en/costs), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [OMP Grok usage parser](https://github.com/can1357/oh-my-pi/blob/5964a0f7649275bcde818f20073193fd032451f2/packages/ai/src/usage/xai-oauth.ts), [xAI API limits](https://docs.x.ai/developers/rate-limits), [Copilot usage and billing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing), [Gemini quota guide](https://geminicli.com/docs/resources/quota-and-pricing/).

Subscription state can change outside your app because the user is using another agent or interface. Telemetry may lag or be absent, and even usage endpoints can be throttled. Forecasts should be estimates with timestamps, not reservations of provider capacity. Do not show “enough for four hours” as a guarantee derived from a percentage.

Access-token expiry and lost authorization are different. Refresh can repair the former; revoked grants, policy changes or an expired login require the user. Claude's authentication documentation explicitly warns that an unattended session stops if its login expires. API keys also fail through revocation, billing suspension or exhausted budgets. [Claude authentication lifecycle](https://code.claude.com/docs/en/authentication).

Use a durable task state machine with at least these outcomes:

| Condition | Product response |
|---|---|
| Transient throttle | Bounded backoff with jitter; honor retry/reset metadata; reduce new admissions |
| Included allowance exhausted | Checkpoint and pause until known reset, or use only a previously authorized fallback |
| Authentication expired/revoked | Let the credential owner attempt supported refresh; then request sign-in and pause affected work |
| Entitlement/policy denial | Explain that the connected account cannot use this route/model; avoid an endless login loop |
| Network/process failure | Reconcile filesystem and session state before retrying; a tool may already have executed |
| Context/session cannot resume | Start from a studio checkpoint and artifacts; explicitly report the restart |
| Approval required | Pause the action or fail it according to the run policy; do not silently broaden permissions |
| Budget, time or failure threshold reached | Preserve progress, stop admissions and show the exact stopping condition |

Retries of file edits, package installation, deployment and git operations need idempotency or reconciliation. An uncertain request outcome is not evidence that nothing happened. Persist the task ledger and commits independently of a provider session. Native resume is a useful acceleration, not your only recovery mechanism.

Preauthorize fallback explicitly by role, provider, maximum spend and data destination. Otherwise stop. A switch from a subscription to an API key changes the bill; a switch to another provider also changes who receives the source and screenshots. Staying with one provider can still incur charges if that account has overage enabled. Do not promise zero additional charges unless the relevant billing path is verifiably constrained.

A defensible product promise would be: “Runs unattended within your selected permissions, account limits and budget. Progress is checkpointed; when a provider needs sign-in, more allowance or approval, the build pauses and explains how to continue.” Avoid guaranteeing completion time, uninterrupted hours, fixed parallel capacity or unlimited usage from a consumer subscription.

**What changes when execution moves to the cloud**

| Deployment | Where credentials and work live | What changes |
|---|---|---|
| Local desktop | Native stores or local API vault; project and runtime on user's machine | Machine sleep, network loss and user logout can stop work |
| User-owned server/VPS | User signs into runtime on that host through supported device/remote flow | Credentials are remote even though they remain in user-controlled infrastructure |
| Your hosted native runtime per user | Auth/session state and source in an isolated environment you operate | Vendor hosting rules, operator access, retention and tenant isolation become central |
| Your API-backed cloud service | Your service credential or each user's API key in server secret storage | Explicit API billing, per-tenant budgets and commercial service agreements |
| Local inference with remote tools | Provider connection remains on the user's device; commands run remotely | Can reduce token relocation, but work still depends on the device staying connected |

Do not treat moving `auth.json` as a cloud architecture. Login portability, native session portability and filesystem portability are separate questions. OAuth callbacks that target desktop loopback may need supported device flows or forwarding; OS-vault secrets may not be exportable in the same form; native sessions may refer to absolute paths and local state. A copied refresh token can cause rotation races across machines.

Anthropic's documented hosting provision is relevant here, while its restrictions on token intermediation still matter. OpenAI documents remote authentication and recommends API authentication for programmatic/CI workflows; that is not a universal SaaS grant to upload customers' auth stores. Enterprise-oriented identities may be worth investigating for B2B deployments separately from consumer BYO subscriptions. [Codex authentication and deployment considerations](https://learn.chatgpt.com/docs/auth).

Copilot is a useful positive reference: its multi-user deployment docs explicitly cover per-session authentication and server configuration. They require care to avoid ambient tools and credentials leaking across users. Your service still needs OS/container isolation, authenticated control channels, per-tenant workspaces, secrets exclusion from repositories/logs, deletion and revocation. A runtime session identifier is not a tenant security boundary. [Copilot server deployment](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/multi-tenancy).

If using a broker, prefer one refresh authority and minimize which clients receive usable provider tokens. A gateway can protect downstream workers from seeing tokens but becomes able to observe prompts, source and outputs. Protecting a token from a worker does not make the gateway blind, nor does encryption at rest prevent the service from accessing a credential during execution. This is a custody decision to disclose, not merely an implementation detail.

**Choices for this product, and how to decide**

| Option | Best reason to choose it | Cost/limitation |
|---|---|---|
| Native subscription agents first | Closest to your working product; preserves mature coding loops and supported login | Several adapters, runtime distribution/updates, provider-specific permissions and quotas |
| API/local studio loop first | Strongest control over tools, criticism, budgets and deployment | Users' consumer subscriptions usually do not pay; you own agent reliability |
| Copilot or another expressly supported app integration | Documented application auth and, for Copilot, multi-user server design | Another agent ecosystem and billing/feature contract to integrate |
| Funded gateway/API service | Easiest path for customers with no existing account | You own cost exposure and must price autonomous multi-agent runs sustainably |
| Community subscription adapters | Broad experimental provider coverage and reusable implementation lessons | Maintenance and authorization uncertainty; weak basis for a promised commercial feature |

My practical starting point is a hybrid. Productize the native runtime manager and the durable scheduler you already have; prioritize Codex App Server, resolve the Claude SDK/native-hosting boundary, and investigate Grok Build or the supported xAI integration route and Copilot SDK as additional subscription options. Offer direct API keys alongside them. Add local inference for models and roles that pass a task-specific evaluation. A funded API/gateway option can serve users arriving with nothing.

The local repository already separates Claude and Codex engine implementations and currently discovers external CLIs and launches terminal login. That makes graphical runtime installation, native sign-in status and explicit connection records the immediate onboarding work. The code also contains assumptions about subscription-only billing that will need deliberate revision as BYOK is introduced. This research makes no code changes to those paths. Relevant files: `src/substrate/engines/claude-cli.ts` (Claude CLI integration), `src/substrate/engines/codex-cli.ts` (Codex CLI integration) and `src/substrate/engines/codex.ts` (Codex engine), as they stood then.

Before committing a provider to the paid product, answer a short set of concrete questions: Can this exact integration be distributed commercially? Which OAuth client and endpoints may it use? Can it run unattended and concurrently for the same individual? Can the runtime be hosted by you? Who may store and refresh tokens? Which quota and billing events are stable interfaces? What happens on revocation and account deletion? Send vendors the proposed data flow and runtime boundary; a generic “can we use OAuth?” question is too vague.

Then test the operational contract on a clean machine: browser onboarding, token refresh while several workers run, quota exhaustion, login revocation, app crash, device sleep, image delivery, reasoning-option rejection, session recovery and worktree isolation. Measure completed game tasks per account budget rather than comparing only model response quality. These are proposed validation steps, not tests performed for this report.

**Source snapshots and evidence limits**

The following repositories were downloaded and inspected. Links above pin implementation claims to these commits where practical.

| Repository | Commit |
|---|---|
| NousResearch/hermes-agent | `96e1e3f9219e56d16641c447e62adfbb0ea067ec` |
| anomalyco/opencode | `5cf9f517cfec3ef68d3e68a12a6a4b3163947f44` |
| earendil-works/pi-mono, formerly badlogic/pi-mono | `92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c` |
| can1357/oh-my-pi | `5964a0f7649275bcde818f20073193fd032451f2` |
| zed-industries/claude-agent-acp | `f74a51758dc42896addbcdaf7611a29ec1d1db17` |
| numman-ali/opencode-openai-codex-auth | `bec2ad69b252ef4ad7dd33b9532ff8b4fdb6d016` |

Official documentation establishes advertised contracts; source establishes implementation at a snapshot; named commercial integrations establish precedents. None alone proves your future integration's contract, actual account entitlement or sustained performance. Private partner agreements and closed-source credential implementations were not available. Exact supported models, limits, plan names and runtime versions should be revalidated before release.
