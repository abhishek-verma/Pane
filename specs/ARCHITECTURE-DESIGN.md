# Pane — Architecture Design

> **Status: v0.4 (intrinsic / State A).** This is the architecture **design** for Pane as a pure open-source product with **no Pane-operated servers**. It does **not** spec State B features (cloud sync, hosted credits, hosted skills marketplace, cloud-headless runner, team/shared context). It defines the **interfaces** at which those can later plug in, so the core never has to be redesigned. State B is out of scope here by design.
>
> **Read alongside:** [`ARCHITECTURE.md`](../ARCHITECTURE.md) (the *current* BrowserOS architecture, as-built) and [`PRODUCT.md`](../PRODUCT.md) (the product lens). This doc is the *target intrinsic architecture* expressed as extensions of the current fork. Product behavior lives in [`specs/`](./README.md); this doc is the engineering design that realizes it without redundant or conflicting work.
>
> **v0.4 expert-architecture review.** Reviewed for desktop-system, browser, agentic, and cross-platform concerns. Additions: a real **process model & supervision** section (boot order, CDP-as-security-boundary, crash recovery, reconnect, update coordination); **keep-alive/headless precision** (a headless server still needs a browser process for browser work); **state-ownership boundary** between the SW's `chrome.storage` and the server's SQLite; **loop discipline** (prompt budget, consequence-class derived from `(tool, args)`, instruction channel never writable by captured data, one tool spec shared by loop + MCP); **streaming-ASR feasibility** for real-time meetings + a native tab-audio primitive; a **platform matrix** (macOS/Windows/Linux); and **degradation / local observability / testing** sections.
>
> **v0.4 disable & cleanup review.** Reviewed from product + tech perspectives for what BrowserOS ships by default that Pane doesn't need. Expanded §9 into a full **disable & cleanup register**: product rationale (account, usage/credits, cloud sync, Remote Hermes, hosted default provider, managed-Klavis catalog, JTBD survey, BrowserClaw cockpit, bug-reporter), the **not-flag-gated** surfaces that must be explicitly removed (auth routes + `AuthProvider` polling, JTBD survey, `/settings/usage`, managed-Klavis nav, remote chat-history branch), server routes to **dead-stripe** rather than 503, hardcoded Pane URLs to strip/repoint, the **native-telemetry hardcoded-key credibility blocker**, and the **don't-bundle-BrowserClaw** decision (fold useful surfaces into `apps/app` later).

---

## 0. Purpose & scope

Pane is a fork of BrowserOS: a Chromium fork plus a Bun/Hono agent server plus a WXT React app. Most of the substrate already ships. This doc defines:

1. The **target intrinsic architecture** — the pure-OSS, no-Pane-server product — as a set of extensions to existing substrates, with exact attachment points.
2. The **extension-point interfaces** that make State B plug-in-able later without redesign (interfaces only; no State B implementations).
3. The **disable map** — what to turn off in the Pane fork to honor "no Pane servers," reusing the feature-flag machinery that already exists.
4. The **"no redundant work" map** — for each net-new subsystem, the substrate it extends, where the new code lives, and what it must not rebuild.

**Non-goals (this doc):** State B server designs; a phased timeline (see [13 — System Architecture](./13-roadmap.md) for the system model); UI copy and flows (see the specs).

---

## 1. The system in one diagram

```mermaid
flowchart TB
    subgraph chromium [Chromium fork — packages/browseros]
      browser[Browser process<br/>CDP WS :cdpPort<br/>native browserOS API + glow + tab-capture]
    end

    subgraph server [@browseros/server — Bun/Hono :9100]
      loop[ToolLoopAgent<br/>AI SDK — single loop]
      tools[Tool registry<br/>16 browser + 7 fs + context + capture + nudge]
      graph[Context Graph + buckets<br/>SQLite + FTS5]
      mem[Memory + learning loop<br/>~/.browseros/memories/]
      trust[Trust gate<br/>consequence classes + dry-run + audit]
      sched[Scheduler + triggers<br/>chrome.alarms bridge + keep-alive]
      reach[Reach<br/>OS push + SMTP/IMAP + Telegram bot]
      capture[Passive capture<br/>meeting + browsing → graph/mem]
      adaptors[State B adapters<br/>SyncAdapter / RunnerAdapter / MarketplaceSource / ... — no-op defaults]
    end

    subgraph app [@browseros/app — WXT]
      ui[Single app entrypoint<br/>newtab + settings + onboarding + home]
      side[Sidepanel chat/agent]
      bg[Background SW<br/>alarms + reach + capture triggers]
      glow[Glow content script]
    end

    subgraph dev [Developer surface — the wedge]
      mcp[Pane-as-MCP /mcp]
      cli[browseros-cli Go]
      harness[Harness agents claude/codex]
    end

    browser -->|CDP| server
    server --> app
    app --> browser
    dev -->|MCP / SSE| server
    loop --> tools
    tools --> graph
    tools --> trust
    capture --> graph
    capture --> mem
    graph --> mem
    mem --> loop
    sched --> loop
    reach --> app
    adaptors -. optional, not built .- graph
    adaptors -. optional, not built .- mem
    adaptors -. optional, not built .- sched
```

The invariant: **one loop, one graph, many surfaces.** Sidepanel, new tab, agent-command, CLI, and harness agents all drive the same `ToolLoopAgent` over `/chat` or `/mcp`. New intrinsic tools register once and appear on every surface.

---

## 2. Architecture principles (intrinsic-first)

1. **Local-complete; servers are optional extensions.** Every capability works with no Pane server. Server-dependent behavior is behind an interface with a local no-op/default.
2. **Build on the substrate.** Each net-new subsystem names the existing package/route/tool it extends and says "extend," not "build." A proposal to rebuild an existing capability is rejected.
3. **One loop, one graph, many surfaces.** Don't fork the agent loop or the context store per surface.
4. **One graph, bucketed.** A single source of context truth, partitioned by bucket; retrieval is bucket-aware.
5. **Trust is a runtime concern.** Consequence classes + dry-run + audit live in the loop's tool path, all local.
6. **Performance is a hard budget.** Indexing, capture, and the learning loop are cadenced and pause on battery; a browsing-quality regression test gates CI.
7. **The fork is load-bearing.** Passive audio capture, a persistent agent runtime, the developer MCP surface, and lineage privacy require being the browser process. We pay the fork cost because the thesis breaks without it.

---

## 3. Current-state baseline (what exists and we keep)

Grounded in the repo today. Paths are relative to repo root; the agent monorepo is `packages/browseros-agent/`.

### 3.1 Repo layout

| Path | What | Keep? |
|------|------|-------|
| `packages/browseros/` | Chromium fork (in-repo, Python build, Chromium 148.x, macOS Sparkle OTA patches) | Yes — the browser |
| `packages/browseros-agent/` | Bun workspace: `apps/*` + `packages/*` | Yes — the agent platform |
| `apps/server` (`@browseros/server`) | Hono/Bun agent server, :9100 | Yes — extend |
| `apps/app` (`@browseros/app`) | WXT React extension/app | Yes — extend |
| `apps/cli` (`browseros-cli`, Go) | CLI over MCP | Yes — extend |
| `apps/eval` (`@browseros/eval`) | Benchmark harness | Yes — extend |
| `apps/claw-*` | BrowserClaw stack (separate product, :9200) | Out of scope — don't bundle in Pane builds; keep code for upstream parity; fold useful surfaces (MCP board, audit) into `apps/app` later (§9.7) |
| `packages/browser-core` | CDP-backed browser session facade | Yes — substrate for graph/capture |
| `packages/browser-mcp` | 16 browser tool defs + MCP registration | Yes — substrate |
| `packages/cdp-protocol` | Generated CDP types | Yes |
| `packages/shared` | Constants, Zod schemas, paths | Yes |
| `packages/build-server-tools` | Server build + R2 upload | Yes (R2 = static host, not a product server) |

### 3.2 Server (`apps/server`)

- **Process:** Hono on Bun. At startup it **connects to an already-running Chromium via CDP WebSocket** (`BROWSEROS_CDP_PORT`) — it does *not* spawn the browser (`src/main.ts`). This matters: "headless/keep-alive" is largely already true — the server is a sidecar independent of the app UI.
- **Routes (`src/api/routes/index.ts`):** `/health`, `/shutdown`, `/status`, `/test-provider`, `/acpx/probe`, `/refine-prompt`, `/oauth`, `/klavis`, `/credits`, `/mcp`, `/mcp/nudge`, `/mcp-manager`, `/chat`, `/screencast`, `/agents`, `/remote-hermes`.
- **Loop:** AI SDK `ToolLoopAgent` in `src/agent/ai-sdk-agent.ts`, orchestrated by `src/api/services/chat-service.ts`. `stopWhen: stepCountIs(MAX_TURNS)`, with `prepareStep`.
- **Tools (in-process, used by `/chat`):** 16 browser tools (via `buildBrowserToolSet`), filesystem subset per workspace mode (`buildAgentFilesystemToolSet`), Klavis mirror, custom user MCP servers, nudge sentinels (`suggest_schedule`, `suggest_app_connection`).
- **Sessions:** sidepanel `/chat` sessions are **in-memory only** (`agent/session-store.ts` — a `Map`). Harness sessions are on disk under `~/.browseros/agents/harness/`.
- **SQLite** `~/.browseros/db/browseros.sqlite` (`lib/db/client.ts`, Drizzle): tables `agent_definitions`, `oauth_tokens`, `produced_files` (the last is **half-wired — SQL-only, no Drizzle schema module**).
- **Config:** `~/.browseros/` (dev `~/.browseros-dev`), `BROWSEROS_DIR` override, `server.json` autodiscovery, identity file. Precedence: CLI > config file > env > defaults (`src/config.ts`).

### 3.3 Tools we build on

- **16 browser tools** (`packages/browser-mcp/src/tools/registry.ts`): `tabs, tab_groups, navigate, snapshot, diff, act, download, upload, read, grep, screenshot, pdf, wait, windows, evaluate, run`.
- **7 filesystem (Cowork) tools** (`apps/server/src/tools/filesystem/`): `filesystem_read/write/edit/bash/grep/find/ls`, with a path-boundary sandbox (`path-boundary.ts`).
- **Nudge tools:** `suggest_schedule`, `suggest_app_connection`.
- **Chat mode** restricts to a read-only browser subset (`agent/chat-mode.ts`) — the precedent for non-mutating tool gating.

### 3.4 App (`apps/app`)

- **Single `app` entrypoint** (`entrypoints/app/App.tsx`, React Router v7 `HashRouter`) serves new tab + home + settings + onboarding + connect-apps + scheduled. Sidepanel, background, and content scripts are separate entrypoints.
- **Chat/agent:** sidepanel (`screens/sidepanel/`), newtab inline (`/home/chat`), agent-command (`/home/agents/:id`). `ChatModeToggle` switches chat (read-only) vs agent; default `agent`.
- **Glow:** content script overlay + stop button + confetti (`entrypoints/glow.content/`).
- **Workspace:** folder picker only (`components/elements/workspace-selector.tsx`, `lib/workspace/workspace-storage.ts`); `local:workspaceFolders`, `local:selectedWorkspace`; sent as `userWorkingDir`. **No file browser UI.**
- **Scheduled tasks:** WXT `local:scheduledJobs`/`local:scheduledJobRuns`, run via `chrome.alarms` in the background SW (`entrypoints/background/scheduledJobRuns.ts`), executing by streaming `/chat` with `isScheduledTask:true`. Cloud sync gated by `cloudSync`.
- **Smart nudges:** server-side nudge tools → parsed in sidepanel into `ScheduleSuggestionCard` / `ConnectAppCard`.
- **Connect Apps (Klavis):** `#/connect-apps`, gated `VITE_KLAVIS_INTEGRATIONS`.
- **Pane-as-MCP:** MCP URL `http://127.0.0.1:{proxyPort}/mcp` (from `PROXY_PORT` pref); `claude mcp add` snippets in `screens/mcp-settings/QuickSetupSection.tsx`.

### 3.5 Developer surface, eval, build, telemetry

- **CLI (Go, Cobra):** MCP over StreamableHTTP to `/mcp`; commands for navigate/observe/input/raw-cdp/resources/strata/setup; self-update from a static manifest on `cdn.browseros.com`.
- **Harness (`AGENT_HARNESS_SUPPORT`, version-gated ≥0.46.0.0):** adapters **claude + codex only** (Qwen Code is an OAuth *LLM provider*, not a harness). MCP injected into the spawned agent (`browseros` → `/mcp`, `nudge` → `/mcp/nudge`).
- **Eval (`apps/eval`):** WebVoyager, Mind2Web, AGI SDK, WebArena-Infinity, WebBench, BrowseComp; graders include state-diff + an LLM judge; publishes to R2 → `eval.browseros.com`; spawns BrowserOS + server per worker.
- **Build:** `bun run dev:watch` (WXT HMR + Pane binary + server via the `browseros-dev` Go supervisor); `build:server` (cross-platform Bun binaries), `build:agent` (WXT); Chromium built via `packages/browseros/build` (Python). Tagged releases: `agent-extension/v*`, `agent-server/v*`, `cli/v*`.
- **Auto-update:** macOS **Sparkle** OTA patches exist; **code-signing is not wired in CI** (nightly builds are unsigned). Prebuilt downloads on `files.browseros.com` / `cdn.browseros.com`.
- **Telemetry:** PostHog (app `lib/analytics/posthog.ts`, server `lib/metrics.ts`, CLI, Chromium native `chrome.browserOS.logMetric` bridge) + event constants `lib/constants/analyticsEvents.ts` (~90 events); Sentry (server + app).

### 3.6 The disable map (already mostly in place)

The Pane fork's "no Pane servers" posture is largely a **build-flag** decision, not new architecture:

| Surface | Lever | Pane fork setting |
|---------|-------|-------------------|
| Hosted inference / `browseros` provider | `VITE_HOSTED_INFERENCE` (`lib/constants/product-features.ts`) | **false** |
| Cloud sync / GraphQL / sign-in | `VITE_CLOUD_SYNC` | **false** |
| Klavis Connect Apps UI | `VITE_KLAVIS_INTEGRATIONS` | **false** (Klavis is third-party; keep optional) |
| Remote Hermes | `VITE_REMOTE_HERMES` + `AGENT_RUNNER_JWT_SECRET` | **false / unset** |
| Credits / billing UI | `VITE_CREDITS_BILLING` + `Feature.CREDITS_SUPPORT` | **false** |
| Server `/credits` | needs `browserosId` + `BROWSEROS_CONFIG_URL` origin | leave unset → 503 |
| Server `/remote-hermes` | needs `AGENT_RUNNER_JWT_SECRET` | leave unset → soft `not_configured` |
| Server `/oauth` | needs `tokenManager` | leave unset → 503 (or keep for OAuth subscriptions — see §9) |

All five `VITE_*` flags already default `false` and the server routes degrade gracefully without their env — but "set flags false" is **necessary, not sufficient**: several surfaces are **not flag-gated** and stay reachable (auth routes, JTBD survey, `/settings/usage` direct URL, managed-Klavis nav, remote chat-history branch), and the native telemetry key is **hardcoded**. The full, concrete cleanup register — product rationale plus per-surface tech actions — is **§9**. Read §9 as the authoritative disable list; this table is the quick-look.

### 3.7 Inconsistencies to fix now (not defer)

These are existing bugs/gaps the design must correct, because they conflict with the wedge:

1. **`chrome://browseros/mcp` is broken.** The Chromium patch maps it to `app.html#/mcp`, but `entrypoints/app/App.tsx` has **no `/mcp` route** → catch-all redirects to `/home`. The real page is `#/settings/mcp`. **Fix:** add a `/mcp` route (alias to the MCP settings view) or repoint the patch. This is the wedge's front door.
2. **`claude mcp add` setup UI is gated behind `VITE_KLAVIS_INTTEGRATIONS`.** The dev wedge's one-line setup shouldn't depend on the Connect Apps flag. **Fix:** move `QuickSetupSection` out from under `IntegrationsSection`'s Klavis gate; keep URL copy + `claude mcp add` snippets always visible.
3. **Sidepanel sessions are in-memory only.** A server restart loses chat history. **Fix:** persist sessions to SQLite (extend `lib/db/`) — required before memory/session-archive can work.
4. **`produced_files` is half-wired** (SQL-only, no Drizzle schema module). **Fix:** add the schema module — and use the same pattern for new tables.
5. **Rebrand is partial.** `PRODUCT_NAME='Pane'` and `PaneMark`/`PaneWordmark` exist, but internal IDs are unchanged (`browseros` provider type, `chrome.browserOS` API, `@browseros/*` packages, `chrome://browseros/*` URLs, storage keys). **Decision:** finish user-facing rebrand; treat internal-ID renames as tech debt (renaming packages/APIs is high-churn, low-value right now). Aliases (`chrome://pane/*`) optional.
6. **`CONTRIBUTING.md` is stale** (references `yarn`, non-existent `apps/controller-ext`). **Fix:** update against the real layout in §3.
7. **Server-dependent surfaces that are NOT flag-gated.** Auth routes (`/login`,`/profile`,`/logout`) + `AuthProvider` polling `api.browseros.com`, the JTBD survey (`#/settings/survey`, `jtbd-agent.fly.dev`), `/settings/usage` direct URL, managed-Klavis nav + in-chat nudge, and the remote chat-history GraphQL branch are all reachable with every `VITE_*` flag false. **Fix:** unregister / remove in the Pane build profile (§9.3) — these are the real disable work, not the already-gated UI.
8. **Native telemetry is hardcoded.** The Chromium patches bake in a PostHog key + Sentry minidump URL that settings can't disable. **Fix:** patch the native metrics service to pref-read + default off in Pane builds (§9.6) — a credibility blocker for the OSS posture.

---

## 4. Target intrinsic architecture — subsystem by subsystem

For each subsystem: **what it is**, **substrate it extends** (real path), **where new code lives**, **data model**, **exposed interface**, and the **State B extension point** (interface only).

### 4.0 Loop discipline (cross-cutting — applies to every subsystem)

Before the subsystems, four rules that govern the agent loop and prevent the most common agentic-system failure modes. These are structural, not policy, and every subsystem below inherits them.

- **Prompt budget.** The graph + memory + skill index + capture all want into the prompt. There is a **fixed token budget** split across `current_work` / search snippets / memory / skill-index, with **eviction** (oldest / lowest-`usefulness` first) when exceeded. FTS5 returns **snippets**, not full documents; skill **index** (names + one-liners) in prompt, bodies on demand; memory entries are char-bounded. The budget is the structural defense against context bloat silently degrading the model.
- **Consequence class is computed, not asserted.** The trust gate (§4.8) derives the consequence class from `(tool, args)` — e.g. a `filesystem_write` to a path outside the granted workspace is `system`, not `write-local`; a browser `act` whose target is a payment form is escalated. The model never decides its own consequence class; the gate inspects the actual call. A prompt-injected "you already have approval" does not change the class. This is the core injection-resistance point.
- **The instruction channel is never writable by data.** Captured content (meeting transcripts, scraped pages, file contents) enters the loop **only as tool-result data**, never as system/user instructions. The system prompt and tool definitions are static and trusted; only the user's composer text and tool results are data. This structurally limits prompt-injection blast radius (complements, does not replace, the approval gate).
- **One tool spec, two paths.** Each tool has **one spec** (schema + consequence class + handler) shared by the in-process loop builder and the MCP registration (§7.4) — no behavioral drift between the sidepanel and external clients like Claude Code.

### 4.1 Context Graph + buckets

- **Substrate:** `browser-mcp`/CDP extractors (`snapshot`, `read`, page-markdown via `browser-core` content-markdown), the 7 filesystem tools (file events), session persistence, the SQLite client (`lib/db/client.ts`, Drizzle).
- **New code:** a `@browseros/context-graph` package (server-side library) + a thin server module that registers context tools and ingests events. Lives under `packages/browseros-agent/packages/context-graph/` + `apps/server/src/context/`.
- **Data model:** extend the existing SQLite client (fix the `produced_files` pattern; add Drizzle schema modules). New tables: `graph_nodes`, `graph_edges`, `graph_events`, `buckets`, and an FTS5 virtual table `graph_index`. **Decision: extend `browseros.sqlite`, not a parallel DB** — one client, one migration path. Every node/edge carries `bucket_id` + `provenance` + timestamps.
- **Ingest:** browser tool calls, filesystem ops, scheduled runs, and capture items emit graph events. The tool path already writes results; add a post-tool hook that writes a graph event + node/edge. No new extraction pipeline — reuse what the tools already return.
- **Context tools (register once, appear on `/chat` and `/mcp`):** `context.current_work`, `context.search` (FTS5), `context.recall` (memory-backed). Add to the in-process tool builder (`agent/tool-adapter.ts`) and to `registerBrowserTools`/the MCP server so external clients get them too.
- **UI:** a Context panel — "what Pane knows right now," per-domain grants, bucket switcher. New route `#/context` (sidebar entry); the per-domain grant model feeds the trust panel (§4.8).
- **Performance budget:** FTS5 first; on-device embeddings opt-in, idle-priority, pause-on-battery; indexing cadenced (batched, not per-navigation); a browsing-quality CI gate vs. bare-browser baseline.
- **Extension point (interface only):** `SyncAdapter` — `subscribe(changes: GraphChange[]): void` / `exportSince(cursor): GraphBatch`. **Local default: no-op.** A future cloud sync implements it; the graph never calls a server directly.
- **Do not rebuild:** browser extraction (`browser-mcp`), file ops (`filesystem_*`), the SQLite client.

### 4.2 Memory + auto-skill learning loop

- **Substrate:** none direct — v0.46 pulled Skills/Soul/Memory back intentionally. This is the core net-new rebuild. It *consumes* the Context Graph (§4.1) and the model resolver.
- **New code:** a `@browseros/memory` package + server module under `apps/server/src/memory/`. On-disk under `~/.browseros/memories/` (files) + a SQLite index.
- **Data model:** memory = files (`MEMORY.md`, `USER.md`, per-topic) + a `memory_entries` SQLite table (id, layer, bucket, content, char-limit-bounded, `last_surfaced`, `usefulness`). Skills = `~/.browseros/memories/skills/*.md` (agentskills.io format) + a `skills` SQLite table (name, description, provenance, `source_run`, `uses`, `success_rate`, `status`). The skill **index** (names + one-line descriptions) loads into the prompt; bodies load on demand (the Hermes "no heavy backpack" lesson).
- **The loop:** a background review job (cheaper model, via the existing model resolver) reads recent graph events + agent runs + passive-capture feeds (§4.7), drafts `SKILL.md` patches and memory writes, and stages them per the `write_approval` default (conversation-derived writes free + verbose notify; inferred/capture-derived writes stage). Runs as a queued job on the server, cadenced, pause-on-battery.
- **Curation half (anti-bloat):** use-tracking demotes then archives unused skills (`uses=0` after N days → archived; `success_rate` below threshold over K uses → flagged then archived); memory entries never recalled are demoted out of the always-on prompt (still searchable). A monthly curation digest is emitted via the proactive engine (§4.5).
- **Loop integration:** register memory retrieval as context tools (§4.1); the review job reuses the scheduled-tasks runtime (§4.5) as its scheduler — don't build a second scheduler.
- **Extraction bar + bounded review input.** The review job reads a **bounded rolling window** of recent graph events + runs (a cap, not "all history"), and only proposes a skill when a workflow repeats with a successful outcome above a threshold (the existing `min_tool_calls` + a repeat count). A cheap model writing skills from a compact digest can produce bad skills — the curation loop catches the back end; this bar catches the front end. Drafts that don't meet the bar are discarded, not staged.
- **Extension points (interface only):** `MemoryProvider` (external memory like Honcho/Mem0) — **local default: the 5 built-in layers.** `MarketplaceSource` (hosted skills directory) — **local default: own-skills + agentskills.io import-by-URL/file.**
- **Do not rebuild:** the model resolver, the agent loop, the scheduler.

### 4.3 Workspaces, files, terminal (evolve Cowork)

- **Substrate:** the 7 `filesystem_*` tools + `path-boundary.ts` sandbox (server); `workspace-selector.tsx` + `workspace-storage.ts` (app).
- **Evolve (server):** `ResolvedAgentConfig.workingDir` (a path today) → a **workspace object** `{ root, scope, terminalPolicy, bucketId }`. Extend `buildAgentFilesystemToolSet` to take the workspace object. Extend `path-boundary.ts` with a **terminal denylist** + per-workspace policy. `filesystem_bash` already exists; add terminal **session reuse** (persist cwd, named sessions) and emit terminal sessions as graph nodes.
- **Evolve (app):** `workspace-storage.ts` today stores a single `selectedWorkspace` — extend to a **set** of workspaces with scopes + a switcher. Build the missing **file browser UI** (a Workspaces screen + sidebar switcher). This is net-new UI but on an existing storage primitive.
- **Extension point (interface only):** `WorkspaceSync` (metadata sync) — **local default: no-op.**
- **Do not rebuild:** the 7 filesystem tools, the path sandbox, the folder picker primitive.

### 4.4 Tasks + executable tasks

- **Substrate:** the scheduled-tasks runtime (`chrome.alarms` + `/chat` with `isScheduledTask`).
- **New code:** a Tasks layer — `tasks` + `task_links` SQLite tables; inbox/triage UI (`screens/tasks/`, new). An **executable task** = a task with an attached agent run or skill. Meeting action items (from §4.7) and graph-derived follow-ups create tasks. A task can be promoted to a scheduled job ("save as scheduled" — the concept already exists as a nudge).
- **Distinction:** scheduled *jobs* (existing, time-based) vs *tasks* (new, the work-management layer). Tasks are the user-facing inbox; jobs are the execution runtime. Tasks → jobs is a one-click promotion.
- **External sync:** via Connect Apps (Klavis — third-party) for Linear/Jira/etc. That path already exists behind `VITE_KLAVIS_INTEGRATIONS`; keep it optional.
- **Extension point (interface only):** `TaskSync` (cloud Linear/Jira) — **local default: no-op (Klavis covers third-party if enabled).**
- **Idempotency & partial-failure recovery.** A scheduled/triggered run that partially completed (some tool calls done, then crash/timeout) must not blindly re-run from scratch and duplicate side effects. Each run carries an idempotency key + a checklist of completed tool calls; on retry, the loop resumes after the last confirmed step, and `write-external`/`spend` calls are deduped by key. Extend the existing `scheduledJobRuns` table with per-step completion so a re-run after a mid-run crash skips done steps.
- **Do not rebuild:** the scheduled-tasks runtime, `chrome.alarms`.

### 4.5 Proactive & scheduled (extend)

- **Substrate:** `chrome.alarms` scheduled jobs + smart nudge tools (`suggest_schedule`, `suggest_app_connection`).
- **Evolve:** a **trigger engine** that subscribes to graph events (§4.1) and fires runs — not just time-based. A **daily digest** (the habit-loop driver) as a first-class scheduled output. **OS keep-alive** is native OS plumbing (`launchd` / Task Scheduler / systemd user unit) and **no Pane server** — but "headless" is not "browser-less for browser tasks": see §7.5 for exactly what runs at login (server always; a minimal browser process lazily, only for jobs that need browser tools; never the full UI).
- **Honest limitation:** closed laptop = no run. A scheduled job needing the browser will not fire on a closed laptop even with keep-alive (no machine on = no browser); non-browser work (file/terminal/reach/memory) fires whenever the machine is awake. Stated in-product, not hidden.
- **Extension point (interface only):** `RunnerAdapter` — `schedule(job, when): handle` / `run(job): result`. **Local default: in-app + OS keep-alive.** A future cloud-headless runner implements it; the scheduler never calls a server directly.
- **Do not rebuild:** `chrome.alarms`, the nudge tools.

### 4.6 Reach (peer-to-peer, new)

- **Substrate:** the server's HTTP stack + the app's background service worker + the OS notification primitives.
- **New code:** a `@browseros/reach` server module + app hooks. Three peer-to-peer transports, none Pane-operated:
  - **OS native push** — local Notification API / native bridge.
  - **Email** — the **user's own** SMTP/IMAP (credentials in the secure store, like OAuth tokens today).
  - **Telegram bot** — the server **polls Telegram's API** (Telegram's servers, not Pane's) and sends; inbound commands route to the loop.
- **Approval-over-channel:** a gated action needing approval while the user is away → the run **pauses** and sends a reach message with an approve/deny deep link (ties into §4.8). Never auto-approves.
- **Extension point (interface only):** `ReachTransport` (mobile companion / cloud-mediated push) — **local default: the three peer-to-peer transports.**
- **Do not rebuild:** the notification primitives, the secure credential store.

### 4.7 Passive capture + buckets (new flagship — requires the fork)

- **Substrate:** `browser-mcp`/CDP (tab capture, page content), the **glow indicator** (repurposed as the capture light), Cowork (local file storage for recordings/transcripts), and **the Chromium fork itself** (privileged tab audio capture via `MediaStream` — extensions can't reliably do this under MV3).
- **New code:** a `@browseros/capture` server module + a **Chromium-side capture primitive in the fork** (`browseros.captureTabAudio` / page-content stream) — the fork is what makes this possible; an extension is the strict-subset downgrade (MV3 `tabCapture` is deprecated and unreliable). Meeting capture = tab audio + page content (participants/chat/shared docs via existing extractors).
- **Local transcription is the load-bearing risk and needs a real-time pipeline, not batch whisper.** Real-time meeting notes need **streaming/chunked ASR** (VAD → small rolling chunks → partial transcripts) plus **diarization** (who spoke) — a batch whisper.cpp job over a full recording is fine for an offline transcript but not for live notes. Options: a streaming local engine (whisper.cpp streaming mode / `faster-whisper` chunked / a dedicated streaming model) hosted alongside the server, **or** BYOK to a provider transcription API (provider server, not Pane's) as an opt-in `TranscriptionProvider`. The native tab-audio primitive is fork work regardless of which ASR path ships.
- **OS mic permission (TCC on macOS, equivalent on Win/Linux):** the OS prompts for mic access **separately** from Pane's in-app consent — onboarding sequences the two (Pane consent first, then the OS prompt) and handles denial gracefully (capture off for that session, not a crash). See §12.
- **Browsing learnings + research bucket:** passive observation (opt-in, per-domain) → facts/workflows feed the memory loop (§4.2); research auto-threading records the page chain with verbatim quotes for citable retrieval. Bucket assignment inferred from domain, shown, reassignable — never silent.
- **Consent:** OFF by default; each capture class + each domain opted in separately; glow = always-visible indicator; bucket-scoped storage; **captured content is untrusted input** (injection defense from §4.8).
- **Performance budget:** capture + transcription are the heaviest intrinsic consumers — cadenced extraction, pause on battery/under-load with a visible "capture paused" state.
- **Feasibility risk to de-risk early:** local **streaming** transcription quality + latency on common laptops, **and** diarization quality. Benchmark before locking; if local streaming is unusable, scope meeting capture to BYOK-only rather than ship a bad local experience or drop the feature. Browsing learnings (text-only, no ASR) are not gated on this.
- **Extension points (interface only):** `TranscriptionProvider` (local default, BYOK provider option); bucket sync via the graph `SyncAdapter`.
- **Do not rebuild:** CDP extraction, the glow, the local-model host (reuse the local-model path).

### 4.8 Trust framework (formalize)

- **Substrate:** the glow, the tool transcript/batches, the existing (implicit) approval on harness, the SQLite client (action log).
- **New code:** a trust gate inserted at the **single chokepoint** in the tool path — every tool call (browser, filesystem, context, capture) passes through it once. Consequence-class metadata is declared on each tool (extend the tool definitions in `browser-mcp`/`filesystem`/the new context+capture tools). The gate composes with `ToolLoopAgent`'s `prepareStep`.
- **Behavior:** `read` free; `write-local` first-time confirm + pinnable; `write-external`/`system`/`spend` **dry-run by default** (draft-and-show / preview-exact-command / always-confirm); a **one-consequential-action-per-run blast-radius cap** for new users that lifts as trust is pinned. Pins expire; `spend` never pinnable. Unattended gated actions pause + ask via reach (§4.6).
- **Audit:** an `action_log` SQLite table (extend `lib/db/`) records every consequential action with input, output, time, approval decision — replayable. Captured content is grounded + approval-gated as untrusted input (injection defense; approvals are necessary-not-sufficient, stated honestly).
- **ICP-tunable defaults** set during onboarding; an approval-fatigue guardrail measures deny+disable rates and re-tunes.
- **Computed, not asserted (cross-ref §4.0):** the class is `f(tool, args)` evaluated by the gate, never the model's claim. The instruction channel is never writable by captured content — approvals are necessary-but-not-sufficient, and injection resistance is structural (the loop cannot be told "approve this" by data it read).
- **Extension point (interface only):** E2E-encrypted sync payloads for the action log — **local default: no sync.**
- **Do not rebuild:** the loop, the glow, the tool transcript UI.

### 4.9 Developer surface (the wedge — mostly shipped)

- **Substrate:** Pane-as-MCP (`/mcp`), `browseros-cli` (Go), harness agents (claude + codex).
- **Net-new (small):** expose the Context Graph + workspace + capture tools over `/mcp` by registering the new context/capture tools alongside the browser tools in the MCP server (the registration path already exists). Add CLI command groups for `context`/`tasks`/`schedules`/`memory` (extend the Go command tree). **Fix the `chrome://browseros/mcp` route and ungate `QuickSetupSection`** (§3.7).
- **This is the wedge and it's mostly already there.** The design work is "wire the new intrinsic tools into the existing MCP surface," not "build a dev surface."
- **Do not rebuild:** `/mcp`, the CLI, the harness adapters.

---

## 5. The "no redundant work" map

The heart of this doc. For each net-new intrinsic subsystem: the substrate it extends (real path), where the new code lives, and what it must not rebuild.

| Subsystem | Extends (substrate, real path) | New code location | Extension-point interface (local default) | Must not rebuild |
|-----------|--------------------------------|-------------------|--------------------------------------------|------------------|
| Context Graph + buckets | `browser-mcp` extractors; `filesystem_*`; `lib/db/client.ts` (Drizzle/SQLite) | `packages/context-graph/` + `apps/server/src/context/` | `SyncAdapter` (no-op) | browser extraction, file ops, SQLite client |
| Memory + skills | (none — v0.46 pulled back); consumes graph + model resolver | `packages/memory/` + `apps/server/src/memory/` | `MemoryProvider` (5 layers); `MarketplaceSource` (own + agentskills.io) | model resolver, loop, scheduler |
| Workspaces + terminal | `tools/filesystem/*` + `path-boundary.ts`; `workspace-storage.ts` | extend `apps/server/src/tools/filesystem/` + `apps/app/screens/workspaces/` (new) | `WorkspaceSync` (no-op) | the 7 fs tools, path sandbox, folder picker |
| Tasks | scheduled-tasks runtime (`chrome.alarms` + `/chat` isScheduledTask) | `apps/server/src/tasks/` + `apps/app/screens/tasks/` (new) | `TaskSync` (no-op; Klavis optional) | scheduled runtime, `chrome.alarms` |
| Proactive + scheduled | `chrome.alarms` + nudge tools | extend `apps/server/src/scheduler/` + `entrypoints/background/` | `RunnerAdapter` (in-app + keep-alive) | `chrome.alarms`, nudge tools |
| Reach | server HTTP + background SW + OS notifications | `packages/reach/` + `apps/server/src/reach/` | `ReachTransport` (OS push + SMTP/IMAP + Telegram) | notification primitives, credential store |
| Passive capture | `browser-mcp`/CDP; glow; Cowork; **the fork** | `packages/capture/` + `apps/server/src/capture/` + Chromium patch | `TranscriptionProvider` (local whisper; BYOK opt-in) | CDP extraction, glow, local-model host |
| Trust | glow; tool transcript; loop `prepareStep`; SQLite | trust gate in `apps/server/src/agent/` (chokepoint) + `lib/db/` action log | action-log sync (no sync) | the loop, the glow, transcript UI |
| Dev surface (wedge) | `/mcp`; `browseros-cli`; harness adapters | register new tools in MCP server; extend Go CLI; fix `#/mcp` route | — | `/mcp`, CLI, harness |

---

## 6. Data & storage architecture

**Layout (`~/.browseros/`, existing):**

```
~/.browseros/
├── db/browseros.sqlite      # existing + new tables (graph, memory index, skills, tasks, action_log, buckets)
├── sessions/                # existing (legacy) — migrate sidepanel sessions here from in-memory
├── memories/                # NEW — MEMORY.md, USER.md, skills/*.md (files; SQLite holds the index)
├── capture/                 # NEW — meeting recordings/transcripts, per bucket
├── agents/harness/          # existing — harness state
├── tool-output/             # existing
└── server.json              # existing — autodiscovery
```

**Decisions:**

- **One SQLite client.** Extend `lib/db/client.ts` (Drizzle) with new schema modules — and fix `produced_files` (add its schema module) as the first instance of the pattern. No parallel DB.
- **Files for memory/skills, SQLite for the index.** Keeps memory inspectable/editable (plain markdown) while the index gives fast prompt loading.
- **Bucket partitioning everywhere.** Every node, edge, memory entry, skill, task, and capture item carries `bucket_id`; retrieval/ingest filter by active bucket(s).
- **Privacy:** incognito/private windows never ingested; index wipeable without deleting the graph; per-bucket retention (raw recordings short, transcripts longer); `pane forget` deletes a node/session/memory/skill/"everything about X" with propagation.
- **Persistence fix required:** sidepanel `/chat` sessions move from the in-memory `Map` (`agent/session-store.ts`) to SQLite — a prerequisite for the session archive (memory layer 3) and for not losing chat on restart.

### 6.1 State ownership & the app↔server boundary

There are **two stores today** and the design must say who owns what, or they drift:

| State | Owner | Store | Why |
|-------|-------|-------|-----|
| Provider/workspace prefs, UI ephemera, onboarding flags | **App (SW)** | `chrome.storage.local` (WXT `local:*`) | read by the UI without a server round-trip; survives SW restart |
| Scheduled jobs (user-facing spec) | **App (SW)** | `chrome.storage.local` → mirrored to server | `chrome.alarms` fires from the SW; the spec lives where the alarm is |
| Graph, memory index, skills, tasks, capture metadata, action log, run state | **Server** | `browseros.sqlite` | heavy, relational, FTS5-indexed, multi-writer |
| Raw capture (audio/transcripts) | **Server** | `~/.browseros/capture/` (disk) | large blobs; never in `chrome.storage` |
| Memory/skill files | **Server** | `~/.browseros/memories/` (disk) | plain markdown, editable, inspectable |

**Rules:**
- **One writer per datum.** Each piece of state has exactly one owning store; the other side reads it via a server route (server-owned) or a message (app-owned). No bidirectional free-form sync that can conflict.
- **App reads server-owned state via routes** (`/context`, `/memory`, `/tasks`, `/capture`), not by copying it into `chrome.storage`. The Context/Memory/Tasks/Capture UIs are thin views over server routes.
- **Scheduled jobs are the one mirrored case:** the spec (prompt, schedule, target) is authored in the app and stored in `chrome.storage` (because `chrome.alarms` is the trigger), and the server receives the spec at run time via `/chat` with `isScheduledTask`. Run results flow back to server SQLite (`scheduledJobRuns`) as the source of truth for history. The app reads history from the server.
- **`chrome.storage` quota:** `unlimitedStorage` is already requested, but capture/memory/skills/graph must **not** live there — they belong server-side. `chrome.storage` is for prefs + the alarm spec only.

### 6.2 SQLite robustness & durability

- **WAL mode** + sane `busy_timeout`; the server is the single writer (the app never writes SQLite directly).
- **`PRAGMA quick_check`** on startup; on a soft corruption signal, quarantine the DB and rebuild the index from durable sources — **memory and skills survive DB corruption because they are files**, not DB rows. This is the trust-property payoff of the files+index split: the user's accumulated intelligence is not hostage to one SQLite file.
- **Forward-only migrations** (`lib/db/migrations/`) with a version pin; first run after upgrade migrates, including the in-memory-session → `chat_sessions`/`chat_messages` move (open decision §14.7).
- **Exportable backups** (a single `pane export` → tarball of `~/.browseros/`) ties to the portability promise; restores verify the schema version.

---

## 7. Process model, lifecycle & supervision

This is the section a desktop/browser architect cares about most: who owns whom, what happens on crash, and how the CDP boundary stays safe.

### 7.1 Boot sequence & ownership

- **Chromium is the parent process** (the user's browser). On startup it writes `server.json` (autodiscovery: port, CDP port, token). The **background service worker** in the extension is the user-facing supervisor: it ensures the Bun server is up (launch on first chat/MCP use, health-check via `/health`), and the server attaches to Chromium via CDP.
- **Single instance:** one server per `BROWSEROS_DIR` (lock file under `~/.browseros/`); a second launch detects the live server and reuses it rather than double-binding.
- **Startup order:** Chromium up → server attaches via CDP → SW health-checks → UI ready. The server does **not** spawn Chromium; it fails fast with a clear message if CDP is unreachable, and the SW retries launch with backoff.

### 7.2 CDP as the browser boundary — and its security

The server drives the browser over **CDP WebSocket**. CDP is a *debug* protocol and is the **highest-value local attack surface** in the product — anyone who can open that socket can drive the user's authenticated sessions (banking, email, everything). Hard rules:

- **Bind loopback only** (`127.0.0.1`); refuse to start if the port is reachable off-host. Never `0.0.0.0`.
- **Token-gate the attach:** the server authenticates to CDP with a per-session token Chromium generated for it; reject unauthenticated attaches.
- **Prefer a Unix-domain socket / named pipe** for the CDP channel where the platform allows (macOS/Linux Unix socket, Windows named pipe), removing the network surface entirely (see §12).
- **Long-term: replace CDP-over-WS with a native mojo/ipc API.** Since we own the fork, the primary runtime path should not be a debug protocol. Keep CDP as the *adapter* the CLI/harness/external-MCP clients use; the in-process server↔browser path moves to a native API. This is an open decision (§14.9), not a v1 blocker, but the boundary is designed so the swap is localized.

### 7.3 Reconnect & crash recovery

- **Per-tab CDP sessions** auto-reattach on target recreation; the server keeps a **target registry**. A tab crash → reconnect; an in-flight agent run whose target vanished **pauses** and reports "tab closed" rather than spinning or erroring into a bad state.
- **Browser-process crash** → server detects the lost CDP connection, marks itself **degraded** (browser tools unavailable; file/terminal/memory/reach still work), the SW relaunches the browser, the server reattaches and clears degraded.
- **Server crash** → the supervisor (SW while the browser is open; the OS keep-alive entry at login — §7.5) restarts it with backoff. SQLite + on-disk memory/skills are durable; the in-memory sidepanel sessions are lost *today*, which is why §6 moves them to SQLite — a server crash then loses nothing.

### 7.4 One loop, many surfaces — and one tool spec

- Sidepanel, new tab, agent-command, CLI, and harness all drive the same `ToolLoopAgent` via `/chat` or `/mcp`.
- **DRY rule (cross-ref §4.0):** there is **one tool-spec module per tool** (schema + consequence class + handler), consumed by both the in-process loop builder (`agent/tool-adapter.ts`) and the MCP registration. Today these are built separately (`buildBrowserToolSet` vs `registerBrowserTools`) and can drift; the design consolidates them so a tool behaves identically whether invoked from the sidepanel or from Claude Code over MCP.
- **Background jobs** (learning-loop review, capture extraction/transcription, curation) run on the server as queued/cadenced jobs, cheaper model, pause-on-battery, reusing the scheduled-tasks runtime as their scheduler.
- **Single trust chokepoint:** every tool call passes the trust gate (§4.8) once, **regardless of caller** — including harness agents and external MCP clients. External clients do not bypass approvals.

### 7.5 Keep-alive & headless — what actually runs at login

"Headless" does **not** mean "browser-less for browser tasks." A scheduled job that uses browser tools needs a browser process. So OS keep-alive launches, at login:

- **Always:** the Bun server — durable state, file/terminal/reach/memory/scheduler work all run without a browser.
- **Lazily, for browser work:** a minimal Chromium process (no extension UI window) when a scheduled/triggered job requires browser tools, torn down after an idle timeout. This is the memory-costing part; keep it lazy, not always-on.
- **Never at login:** the full app UI — the user gets that by opening the browser normally.

Restated honestly (§4.5): a job needing the browser will not fire on a closed laptop even with keep-alive; non-browser work fires whenever the machine is awake.

### 7.6 Updates without data loss or torn state

- The app/server/CLI update independently via static manifests (§10). A **server update**: the SW drains in-flight runs (or lets the current one finish), calls `/shutdown`, swaps the binary, relaunches, reattaches CDP. A **browser (Chromium) update** is heavier (Sparkle on macOS; verify-and-swap on next launch); the server reattaches on next browser launch.
- **Never tear down mid-consequential-action.** The trust gate holds any in-flight `write-external`/`system`/`spend` action: finish it cleanly or cancel it explicitly before a shutdown. A forced shutdown during a consequential action is logged in the action log as interrupted.

---

## 8. The extension-point catalogue (interfaces only — not built)

Every State B capability is behind one of these interfaces, each with a **local no-op / default** so the product is complete without a Pane server. **No State B implementations exist in the Pane fork.**

| Interface | Methods (sketch) | Local default (State A) | What a State B server would add |
|-----------|-------------------|--------------------------|---------------------------------|
| `SyncAdapter` | `subscribe(changes)`, `exportSince(cursor)` | no-op | cross-device graph/memory/task/workspace sync |
| `MemoryProvider` | `recall(q)`, `write(entry)` | built-in 5 layers | external memory (Honcho/Mem0) |
| `MarketplaceSource` | `search(q)`, `install(id)`, `publish(skill)` | own-skills + agentskills.io import-by-URL/file | hosted skills directory |
| `RunnerAdapter` | `schedule(job, when)`, `run(job)` | in-app + OS keep-alive | cloud-headless runner (24/7 without a machine on) |
| `ReachTransport` | `send(msg)`, `pollCommands()` | OS push + SMTP/IMAP + Telegram bot | mobile companion + cloud-mediated push |
| `TranscriptionProvider` | `transcribe(audio)` | local whisper.cpp | BYOK provider API (already supported as opt-in) |
| `CreditsProvider` | `resolve(model)`, `spend(n)` | none (BYOK/OAuth/local only) | hosted credits / default-model on-ramp |
| `TaskSync` | `pull()`, `push(task)` | no-op (Klavis optional for third-party) | cloud Linear/Jira |

The architecture rule: **the core never calls a Pane server directly.** It calls an interface whose default is local. A future server implements the interface; nothing in the core changes.

---

## 9. Disable map & cleanup register (concrete, for the Pane fork)

The disable work splits into **product rationale** (which BrowserOS defaults don't serve Pane's thesis) and **tech actions** (what to compile out, unregister, strip, or repoint). The guiding product principle: **a user should never see a dead-end that implies a server Pane doesn't run.** Disabled surfaces must be *absent* from Pane builds, not merely flag-gated to a 503.

### 9.1 Product rationale — what doesn't serve Pane's thesis

Pane is a pure-OSS, no-Pane-server, local-first browser where the agent lives *inside* the browser. These BrowserOS defaults don't serve that thesis and should be **absent from Pane builds**:

- **Account / sign-in / profile** — Pane has no account server. The whole auth surface is dead weight that undermines the no-server promise.
- **Usage & billing / credits** — tied to hosted inference Pane doesn't run; Pane is BYOK / OAuth-subscription / local-model.
- **Cloud sync** — no Pane servers to sync to.
- **Remote Hermes** — a cloud-VM agent; the agent runs locally in Pane.
- **Hosted `browseros` default provider** — the cloud default model. Removing it *is* the resolution to the no-default-model tension (onboarding leads with OAuth subscriptions + local models instead).
- **Klavis *managed* connector catalog** — proxied through a Pane-operated host (`llm.browseros.com/klavis`), so it's cloud-adjacent, not pure third-party. **Keep custom-MCP-URL connect** (local, core to the dev wedge); drop the managed catalog + in-chat OAuth nudges.
- **JTBD in-product survey** — research tooling that hits `jtbd-agent.fly.dev`; not a product feature.
- **BrowserClaw cockpit app + claw-server** — a *parallel product* for users who run external harness agents (Claude Code/Codex) and want a watch/approve/audit layer. It's local-first (no Pane servers) but it's not the "agent lives in the browser" thesis; maintaining two extensions + two servers isn't justified in the OSS fork.
- **Bug-reporter bundled extension** — hits Pane-operated infra.

### 9.2 Build flags — from "default false" to "compile-time off"

Today `VITE_HOSTED_INFERENCE | CLOUD_SYNC | KLAVIS_INTEGRATIONS | REMOTE_HERMES | CREDITS_BILLING` default false but can be re-enabled by env. For Pane:

- Introduce a **`pane` build profile** that **pins these off at compile time** so the gated code is **dead-stripped** and a stray env var can't silently re-introduce a Pane-server surface.
- Confirm every flag-gated UI is also unreachable by direct URL (see 9.3 — several are *not*).

### 9.3 Routes & nav that are NOT flag-gated today (highest-leverage cleanup)

These are reachable even with all five flags false — the real cleanup, not the already-gated pieces:

- **App routes `/login`, `/profile`, `/logout`** — unregister in Pane builds; remove `AuthProvider`'s continuous polling of `api.browseros.com` and the `sessionStorage` mirror.
- **App route `/settings/survey` + `JtbdPopup` + the `jtbd-agent.fly.dev` client** — remove entirely.
- **App route `/settings/usage`** (direct URL; nav is hidden but the route is live) — remove.
- **`/connect-apps` managed-Klavis nav + `ConnectAppCard` in-chat nudge** — remove the managed path; keep a custom-MCP-URL connect surface.
- **`ChatHistory.tsx` remote GraphQL branch** — remove; local history only (the durable path, and a prerequisite for §6 session persistence anyway).
- **`McpPromoBanner`** — optional trim; it points to local MCP so it's defensible, but it's marketing chrome in a settings page.

### 9.4 Server routes — dead-stripe, don't just degrade to 503

- **Don't register** `/credits/*`, `/remote-hermes/*`, `/klavis/*` in Pane server builds — remove them from the route composition, not just return 503. Strip `RemoteHermesService`, `KlavisService`, and the `browseros`-provider `gatewayBaseUrl` wiring from `api/server.ts`.
- **Keep `/oauth/*` for provider OAuth only** (ChatGPT Pro / Copilot / Qwen — provider servers, not Pane's). Wire `tokenManager` for provider tokens; the 503-on-Pane-account path is correct and stays.
- Strip the `browseros` + `remote-hermes` provider branches from `/chat`, `/test-provider`, `/refine-prompt` (BYOK / OAuth / local-model paths remain).

### 9.5 Hardcoded Pane URLs to strip or repoint

- `api.browseros.com` (auth/GraphQL) — remove from `.env` and manifest; no Pane account.
- `llm.browseros.com` (Klavis proxy + config URL) — remove; managed Klavis is gone.
- `cdn.browseros.com` (CLI auto-update manifest) — repoint to a **static file host we operate as a static host** (or GitHub Releases); this is distribution, not a product server (§10).
- `jtbd-agent.fly.dev` — remove.
- Manifest `externally_connectable` to the API host — remove.
- Manifest `update_url` — repoint to the static update host (§10).
- `packages/shared/src/constants/urls.ts` (`KLAVIS_PROXY`, `AGENT_CONTROL_WORKER`) — remove or dead-stripe.

### 9.6 Native telemetry — the patch that must change

The Chromium patches **hardcode a PostHog key + a Sentry minidump URL** in the native metrics service (`browseros_metrics_service.cc`, `chrome_crash_reporter_client*.cc`) and the key **cannot be disabled via settings**. This breaks the pure-OSS, privacy-first posture at the *deepest* layer — app-level opt-in is meaningless if the native binary phones home regardless. Required for Pane:

- Patch the native metrics service to read its key/endpoint from a pref and **default off** in Pane builds; expose the settings toggle that already exists in the app to actually control it.
- Gate the Sentry minidump URL the same way (off by default).
- This is fork-patch work under §10's patch discipline, not app code, and it's a **credibility blocker** for the OSS posture.

### 9.7 Chromium bundle — don't ship the second product

- In Pane Chromium builds, **do not bundle** the BrowserClaw extension, the `claw-server` binary, or the bug-reporter extension (`packages/browseros/build/modules/extensions/bundled_extensions.py`). Gate the bundling behind a build flag; keep the code in the repo for upstream parity.
- Long-term, **fold** claw-app's genuinely useful surfaces — the one-click "connect Pane to your harness" MCP board and the session audit log — into `apps/app` once the trust framework (§4.8) and tasks (§4.4) land. Audit is a natural fit for the action log. Don't carry two extensions + two servers in the OSS fork.

### 9.8 Telemetry posture (app / server / CLI)

PostHog/Sentry at the app/server/CLI layers are third-party clouds: **opt-in, disable-able, off-by-default** in Pane builds; document self-hosting PostHog. Neutralize the `/credits` and cloud-sync events (the surfaces are gone). The native layer is 9.6; both must align or the posture is theater. (Cross-ref §11.)

### 9.9 Distribution hosts — acceptable, name them honestly

R2/CDN for releases and the CLI self-update manifest are **static file hosts**, not Pane product servers — acceptable for distribution (§10). Repoint them off `*.browseros.com` to a host we operate as a static host (or GitHub Releases) so the no-product-server claim is literally true.

### 9.10 Rebrand

Finish the user-facing Pane rebrand; treat internal-ID renames (`@browseros/*`, `chrome.browserOS`, `chrome://browseros/*`, storage keys) as tech debt. Aliases optional.

---

## 10. Build, packaging & update (intrinsic)

- **Builds exist:** WXT app + Bun server + Go CLI + Python Chromium build. Tagged releases to R2/CDN (a static host) for server/CLI/extension; prebuilt browser downloads on `files.browseros.com` / `cdn.browseros.com`.
- **Auto-update without a Pane product server:** macOS **Sparkle** OTA patches already exist; they need a **signed update manifest on a static host** (GitHub Releases, or a CDN we don't operate as a product server). The update server is a *static file host*, never an update control plane we run. Verify-and-swap on next launch. Server/CLI/extension update via their existing static-manifest paths.
- **Code-signing is the real gap:** not wired in CI (nightly builds are unsigned). macOS notarization + Windows code-signing certs are an OSS-project cost (community-funded certs), not a server cost. Wire signing into `nightly-macos-build.yml` / `nightly-release.yml`.
- **The Chromium rebase treadmill:** `packages/browseros/CHROMIUM_VERSION` (148.x). Rebasing upstream Chromium is a recurring engineering cost, not a milestone — budget it as ongoing; lag stable Chromium by 1–2 minor versions.
- **Patch discipline (the only sustainable way to ride the treadmill):** keep the fork's diff against upstream **small and organized as a patch series** (`patches/`), minimize patch surface, prefer **upstreaming** anything generally useful, and run a CI job that attempts an auto-rebase against upstream stable on a schedule so drift is caught early rather than at release time. The fewer lines we carry, the cheaper every rebase. Tag every patch with owner + rationale so rebases aren't archaeology.
- **Distribution:** the dev wedge has a natural channel (MCP directories, dev demos). Mass-ICP discovery (no app store, no server) is a separate GTM problem, not an architecture problem — out of scope here.
- **This is mostly "wire what exists," not new architecture.**

---

## 11. Telemetry & quality

- **PostHog/Sentry** exist (app, server, CLI, Chromium native bridge). Make opt-in + disable-able for the pure-OSS posture (§9). Add the new events from [12](./12-onboarding-activation-metrics.md): thesis actions, proactive-ping-acted-on, capture-item-acted-on, skill-loaded-into-run. Neutralize the `/credits` and cloud-sync events while those surfaces are disabled.
- **The native layer is the credibility blocker.** The Chromium patches hardcode a PostHog key + Sentry minidump URL that **cannot be disabled from settings** (§9.6). App/server/CLI opt-in is theater until the native metrics service is patched to read its key from a pref and default off in Pane builds. This is fork-patch work and a must-ship for the OSS posture.
- **Eval:** add the **"Pane thesis" eval** (browser + workspace + context + capture end-to-end) to `apps/eval` — extend the existing harness (new config + dataset + grader), don't rebuild it. This is the internal proof the moat pays off and the public credibility artifact.

---

## 12. Platform matrix (macOS / Windows / Linux)

Cross-platform is a first-class concern, not a porting afterthought. The wedge ICP skews macOS, but the architecture must not bake in macOS-only primitives.

| Concern | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Keep-alive / launch-at-login | `launchd` LaunchAgent | Task Scheduler on-logon / Run key | systemd user unit (`WantedBy=default.target`) |
| Headless browser for scheduled browser-work | minimal Chromium, no window | same | same |
| OS notifications | Notification Center (`UNUserNotificationCenter`) | Windows toast (WinRT/XML) | libnotify / DBus |
| Mic access (meeting capture) | TCC `NSMicrophoneUsageDescription` + runtime prompt | Windows mic consent + app capability | PipeWire/PulseAccess (distro-dependent) |
| Code-signing | Developer ID + notarization (required for Sparkle OTA) | Authenticode cert (EV recommended) | optional (AppImage unsigned-warning; deb/rpm via repo signing) |
| Auto-update | Sparkle (patches exist) | WinSparkle or custom signed manifest | AppImageUpdate / zsync; repo updates for deb/rpm |
| CDP transport | Unix-domain socket | named pipe (`\\.\pipe\`) | Unix-domain socket |
| Secure credential store | Keychain | Credential Manager / DPAPI | libsecret / Keyring / KWallet |
| Process supervision | `launchd` KeepAlive | Task Scheduler / small supervisor | systemd user service |

**Decisions:**

- **Abstract OS primitives behind interfaces** (consumed by §4.5/§4.6/§6): `KeepAliveService`, `NotificationSink`, `CredentialStore`, `CdpTransport`. One interface, three platform implementations. No `if (process.platform === 'darwin')` scattered through the core.
- **Start with macOS** (the wedge), but land the interfaces + a Windows implementation before the expand-ICP push. Linux is community/PIE — accept PRs against the same interfaces.
- **Mic capture is an OS-permission friction point:** the OS prompts for mic access *separately* from Pane's in-app consent. Onboarding sequences the two (Pane consent first, then the OS prompt) and handles denial gracefully (capture off for that session, not a crash).
- **The CDP socket/pipe choice is platform-coupled** to the security stance in §7.2 — loopback-token is the floor on every platform; socket/pipe is the better floor where available.

---

## 13. Operational concerns (degradation, observability, testing)

### 13.1 Degradation matrix

A local-first product must degrade gracefully, not fail hard, when a subsystem is unavailable:

| Condition | Degradation |
|-----------|-------------|
| Local model too slow / unavailable | Fall back to OAuth/BYOK model for the turn; warn; never hang |
| Local transcription fails / model missing | Capture records audio + content; defer transcription to next availability or BYOK; browsing learnings unaffected (no ASR) |
| CDP lost (tab/browser crash) | Server marks degraded; in-flight run pauses ("target gone"); SW relaunches browser; server reattaches (§7.3) |
| Graph index rebuilding | Retrieval returns "index warming up" for a bounded window; loop proceeds without recall, not blocked |
| Tool timeout | Loop retries with backoff N times, then reports the failure to the user; never silently loops |
| Disk near-full (capture) | Capture pauses with a visible "disk low — capture paused" state; oldest raw recordings pruned per retention |
| No network | All non-cloud work continues (local models, file/terminal, capture, memory); cloud/BYOK-provider turns fail clearly |

### 13.2 Local observability — the user is the operator

A local-first product has no vendor dashboard. Provide a **local diagnostics surface** (`#/diagnostics` or Settings → Diagnostics):

- Server/CDP/browser health, model connectivity, last error, `~/.browseros/` disk usage.
- The action log (§4.8), the curation digest, capture consent state, per-bucket retention status.
- Self-service controls: **export my data**, **wipe index**, **reset onboarding** — ties to the portability/privacy promise.
- Local logs to `~/.browseros/logs/` with rotation — not only PostHog/Sentry (cloud, opt-in). The user can always see what their agent did and why.

### 13.3 Testing strategy

- **Unit:** per-package (`packages/*`, `apps/server/src/*`) on the existing Vitest setup. New subsystems (context-graph, memory, trust gate, capture, reach) get unit tests with SQLite temp-dir'd or mocked.
- **Integration:** an in-repo suite that boots the Bun server + a headless Chromium (CDP) and exercises the loop end-to-end through `/chat` and `/mcp` — the wedge flow as a regression test.
- **Browsing-quality gate:** the CI test from §4.1 — navigating/tab-switching with the graph on stays within X% of bare-browser latency; regressions fail the build.
- **Eval:** the "Pane thesis" eval (§11) as the agent-quality gate.
- **Chromium-fork tests:** on rebase, run the upstream test suites for the patched `browseros_*` areas so the fork doesn't silently break Chromium behavior. This is the fork-maintenance cost that pays for "we are the browser."
- **Trust-gate invariant tests:** a dedicated suite asserting consequence-class derivation (`(tool, args)` → class) and that the instruction channel rejects injected instructions — the security invariants, tested continuously.

---

## 14. Open architectural decisions

1. **Graph store:** extend `browseros.sqlite` (chosen) vs. a dedicated `graph.sqlite`. *Lean: extend — one client, one migration path; revisit if graph volume pressures the shared DB.*
2. **Memory/skill store:** files + SQLite index (chosen) vs. pure SQLite. *Lean: files + index — inspectability is a trust feature, and memory survives DB corruption (§6.2).*
3. **Local transcription integration:** streaming local engine (whisper.cpp streaming / `faster-whisper` chunked) vs. sidecar vs. local model host — **plus diarization**. *Decision needed; benchmark streaming quality + latency first (§4.7 feasibility risk).*
4. **Keep-alive:** per-OS approach (macOS `launchd`, Windows Task Scheduler, Linux systemd user unit). *Lean: start with macOS login item; land the `KeepAliveService` interface first (§12).*
5. **Telemetry posture:** opt-in PostHog vs. self-hosted vs. off-by-default. *Lean: opt-in + self-hostable, off-by-default in Pane builds.*
6. **Rebrand depth:** how far to take internal-ID renames. *Lean: finish user-facing only; internal IDs are tech debt.*
7. **Sidepanel session persistence:** SQLite table shape + migration from the in-memory `Map`. *Lean: a `chat_sessions` + `chat_messages` table, migrate on first run.*
8. **`chrome://browseros/mcp` fix:** add a `/mcp` route alias vs. repoint the Chromium patch. *Lean: add the route alias — lower churn than patch changes.*
9. **CDP vs native mojo/ipc long-term:** keep CDP-over-WS as the runtime path (v1) vs. move the in-process server↔browser path to a native fork API, with CDP as the external adapter only. *Lean: design the boundary so the swap is localized (§7.2), decide after v1 stability.*
10. **Prompt-budget sizing:** per-model token budget splits across `current_work`/search/memory/skill-index and eviction policy. *Lean: start conservative, tune against the eval (§11).*
11. **Platform-interface ownership:** which team/PR owns the Windows and Linux implementations of `KeepAliveService`/`NotificationSink`/`CredentialStore`/`CdpTransport`. *Lean: interfaces land with macOS impl; Windows before expand-ICP; Linux via community.*
12. **`pane` build profile depth:** compile-time dead-strip the five `VITE_*` cloud flags (and the §9.3 not-flag-gated routes) vs. leave them env-toggleable. *Lean: dead-strip in release builds — a stray env var must not re-introduce a Pane-server surface.*
13. **BrowserClaw fold vs. drop:** fold the one-click MCP board + audit log into `apps/app` (and retire claw-app) vs. keep claw-app as a separate OSS surface. *Lean: fold after the trust framework + tasks land; don't bundle in the meantime (§9.7).*
14. **Native telemetry patch scope:** strip the hardcoded PostHog/Sentry keys entirely vs. pref-read + default-off. *Lean: pref-read + default-off — preserves the option for users who opt in, and keeps the patch small.*

---

## 15. Relationship to existing docs

| Doc | Role |
|-----|------|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | The **current** BrowserOS architecture, as-built (reference for §3) |
| [`PRODUCT.md`](../PRODUCT.md) | The product lens (personas, pillars, IA) |
| [`specs/`](./README.md) | The **product spec** (what Pane does, why, for whom) — this doc realizes it |
| **This doc** | The **target intrinsic architecture design** (how Pane is built, grounded in the current fork, extensible to State B via interfaces) |

The flow: `PRODUCT.md` (what/who) → `specs/` (behavior + flows) → **this doc** (engineering design) → `ARCHITECTURE.md` (current as-built, the substrate). When a spec and the current code conflict, the spec states the intended future state; this doc states the attachment point and the migration.
