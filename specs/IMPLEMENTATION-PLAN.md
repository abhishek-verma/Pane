# Pane — End-to-End OSS Implementation Plan (State A)

> **For agentic workers:** Implement this plan phase-by-phase, module-by-module. Modules marked `[par]` within a phase are independently parallelizable; `[seq → M x.y]` need the named module first. Each phase ends at a **Ship Gate** — a real, usable product with *complete* features. No partial-useless features ship.

**Goal:** Ship Pane — a pure-OSS, no-Pane-server, local-first agentic browser ("Hermes agent but a browser") — in 8 phases, each a usable product.

**Architecture:** Extensions of the existing BrowserOS fork (Chromium fork + Bun/Hono server on `:9100` + WXT React app + Go CLI + harness agents). Net-new intrinsic subsystems per [`ARCHITECTURE-DESIGN.md`](./ARCHITECTURE-DESIGN.md) §4. Every Pane-operated-server surface disabled/removed per §9. One tool spec shared by the in-process loop and MCP (§4.0/§7.4). State owned by the server (SQLite/disk) and the app (`chrome.storage` prefs only) per §6.

**Tech Stack:** TypeScript (Bun/Hono server, WXT React app, AI SDK), Go (CLI), Python (Chromium build), SQLite + Drizzle + FTS5, streaming ASR (whisper.cpp-class) for capture, Chromium C++ patches.

**Phase dependency graph:** `0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`. Phase 0 is the BrowserOS → Pane rebrand sweep (see [`REBRAND-PLAN.md`](./REBRAND-PLAN.md)) — it must precede Phase 1 so the first shippable is a credible *Pane* product, not a half-rebranded fork. Cross-deps: Phase 5 also needs 2; Phase 6 needs 3 + 4; Phase 7 (page reshape) needs 3 + 4 + 2; Phase 8 needs all and is the scale/signing phase. The two "becomes yours" expression surfaces ship on top of the engine: the **adaptive home** in Phase 5 (engine: graph+memory+soul+tasks+proactive), **page reshape & overlays** in Phase 7 (engine: graph+memory+soul+trust+workspace).

---

## Module template

Each module is independently implementable and testable.

- **What:** the capability and its acceptance signal.
- **How to build:** the substrate to extend (real path), new files, key changes, approach.
- **How to test:** unit / integration / eval / manual checks and the pass signal.

Rules that apply to every module (from `ARCHITECTURE-DESIGN.md`):
- **One tool spec, two paths** — each tool's schema + consequence class + handler is defined once and consumed by both the in-process loop (`agent/tool-adapter.ts`) and MCP (`browser-mcp`/`register-mcp.ts`).
- **State ownership** — heavy/relational state is server-side SQLite/disk; the app holds only prefs + the `chrome.alarms` spec in `chrome.storage`.
- **Prompt budget** — fixed token budget with eviction; snippets not documents; skill index in prompt, bodies on demand.
- **Consequence class = `f(tool, args)`** — gate-computed, never model-asserted; instruction channel never writable by captured data.
- **No Pane servers** — no module may call a Pane-operated endpoint; extension points default to local no-ops.

---

## What is explicitly NOT in any phase (State B — planned later)

Cloud sync, hosted credits/default-model, hosted skills marketplace, cloud-headless runner, team/shared context, mobile companion, cloud-mediated push. These plug into the interfaces defined in `ARCHITECTURE-DESIGN.md` §8 (`SyncAdapter`, `CreditsProvider`, `MarketplaceSource`, `RunnerAdapter`, `ReachTransport`, …) whose local defaults ship in these phases. We will plan State B separately after Pane v1.0.

---

# Phase 1 — Bedrock: a credible, honest, local-first Pane

**Ship gate (Pane v0.1):** A rebranded, local-first agentic browser. Sidepanel chat + new-tab home work with BYOK / OAuth-subscription / local models. The Pane-as-MCP wedge works end-to-end (`chrome://browseros/mcp` opens a working page; `claude mcp add` succeeds; the Go CLI drives the browser). Chat sessions survive a server restart. Telemetry is honest and off-by-default (native key patched off). CDP is secured to loopback + token. No Pane-server dead-end is visible anywhere. Builds via a `pane` profile.

> **M1.1 — `pane` build profile + flag dead-strip** `[seq]`
> **What:** A `pane` build profile that pins the five cloud flags off at compile time and dead-strips the gated code, so a stray env var can't re-introduce a Pane-server surface.
> **How to build:** Add a `pane` mode to the WXT/Bun build config. In `packages/browseros-agent/apps/app/lib/constants/product-features.ts`, when `pane` profile is active, hard-resolve `hostedInference`/`cloudSync`/`klavisIntegrations`/`remoteHermes`/`creditsBilling` to `false` regardless of `import.meta.env`. Add a build-time constant `PANE_BUILD` that tree-shakes gated branches. Mirror on the server (`apps/server/src/env.ts`): in `pane` builds, `BROWSEROS_CONFIG_URL` and `AGENT_RUNNER_JWT_SECRET` are forced unset.
> **How to test:** Unit — assert `productFeatures.*` is `false` under `PANE_BUILD` even with env set. Build — run the `pane` build and grep the bundle for `api.browseros.com`/`llm.browseros.com`/`credits` strings → expect none in app chunks. Manual — launch the `pane` build; confirm no sign-in, no Usage, no Connect-Apps managed catalog.

> **M1.2 — Disable & cleanup register (ARCHITECTURE-DESIGN §9)** `[seq → M1.1]`
> **What:** Remove every not-flag-gated Pane-server surface so the product is literally server-free.
> **How to build:** (a) App routes — unregister `/login`, `/profile`, `/logout` in `apps/app/entrypoints/app/App.tsx`; remove `lib/auth/auth-client.ts` + `AuthProvider.tsx` polling and the `sessionStorage` mirror; remove `screens/auth/`, `screens/profile/`. (b) JTBD — remove `screens/jtbd-agent/`, `screens/sidepanel/index/JtbdPopup.tsx`, the `#/settings/survey` route, the `jtbd-agent.fly.dev` client. (c) `/settings/usage` direct-URL route removed; `screens/usage/` gated out. (d) Managed Klavis — remove the managed-catalog path from `screens/connect-mcp/ConnectMCP.tsx` and the in-chat `ConnectAppCard.tsx` nudge; keep custom-MCP-URL connect. (e) Remote chat-history — remove the GraphQL branch in `screens/sidepanel/history/ChatHistory.tsx`; local history only. (f) Server — remove `/credits`, `/remote-hermes`, `/klavis` route registration in `apps/server/src/api/routes/index.ts`; strip `RemoteHermesService`, `KlavisService`, `gatewayBaseUrl` from `api/server.ts`; keep `/oauth` for *provider* OAuth only. Strip `browseros` + `remote-hermes` provider branches from `/chat`, `/test-provider`, `/refine-prompt`. (g) URLs — remove `api.browseros.com`, `llm.browseros.com`, `jtbd-agent.fly.dev` from `.env`/`packages/shared/src/constants/urls.ts`; remove manifest `externally_connectable`; repoint `update_url` + CLI manifest to a static host. (h) Bundle — drop BrowserClaw extension + `claw-server` binary + bug-reporter from `packages/browseros/build/modules/extensions/bundled_extensions.py` behind the `pane` flag.
> **How to test:** Integration — boot the `pane` server; `curl /credits`, `/remote-hermes/*`, `/klavis/*` → 404 (not 503). Static — grep repo (excluding `claw-*` and docs) for `api.browseros.com`/`llm.browseros.com` → expect zero runtime references. Manual — full click-through of the app: no screen ever shows a sign-in, usage, or managed-connectors dead-end.

> **M1.3 — Native telemetry patch + opt-in posture** `[par]`
> **What:** The native PostHog key + Sentry minidump URL become pref-read and default-off in `pane` builds; app/server/CLI telemetry is opt-in, off-by-default.
> **How to build:** Patch `packages/browseros/chromium_patches/chrome/browser/browseros/metrics/browseros_metrics_service.cc` and `chrome_crash_reporter_client*.cc` to read the key/endpoint from a pref, default disabled in `pane` builds, toggleable from the existing app setting. App `lib/analytics/posthog.ts`, `lib/sentry/sentry.ts`, server `lib/metrics.ts`, `lib/sentry.ts`, CLI `apps/cli/analytics/analytics.go` — gate init behind an explicit opt-in pref; no init when empty/opt-out.
> **How to test:** Manual (fork) — launch `pane` build with telemetry off; run the browser for 10 min; observe no outbound calls to `posthog`/`sentry` hosts (network monitor). Toggle on in settings → events flow. Unit — assert init helpers are no-ops when the opt-in pref is false.

> **M1.4 — CDP security boundary** `[par]`
> **What:** CDP binds loopback-only, attach is token-gated, and a Unix-domain socket / named pipe is preferred where available.
> **How to build:** In the Chromium patch that opens the CDP server, bind `127.0.0.1` only (refuse otherwise); generate a per-session token and write it to `server.json`; the server (`apps/server`) authenticates with it. Add a `CdpTransport` interface (§12) with a Unix-socket impl on macOS/Linux and a named-pipe impl on Windows; fall back to loopback-WS + token elsewhere. Reject unauthenticated attaches.
> **How to test:** Unit — token validation. Integration — from a second local process, attempt an unauthenticated CDP attach → rejected; attempt off-host bind → refused. Manual — confirm the agent still drives the browser via the secured channel.

> **M1.5 — Session persistence + `produced_files` schema fix** `[par]`
> **What:** Sidepanel `/chat` sessions move from the in-memory `Map` to SQLite; a server restart no longer loses chat. Fix the `produced_files` half-wiring as the first instance of the schema-module pattern.
> **How to build:** Add `chat_sessions` + `chat_messages` Drizzle schema modules under `apps/server/src/lib/db/schema/`; a forward-only migration; replace the `Map` in `agent/session-store.ts` with SQLite-backed load/save. Add the missing `produced_files` Drizzle schema module (migration `0002_chemical_whirlwind.sql` already exists). The app reads history via a server route, not the removed GraphQL branch.
> **How to test:** Unit — session-store round-trip (create, append, reload after re-instantiation). Integration — start a chat, `POST /shutdown`, restart server, `GET` history → intact. Manual — sidepanel chat survives `pane` restart.

> **M1.6 — Fix `chrome://browseros/mcp` + ungate QuickSetup + single tool spec** `[par]`
> **What:** The wedge's front door works; the one-line `claude mcp add` setup is visible without the Klavis flag; one tool-spec module serves both loop and MCP.
> **How to build:** Add a `/mcp` route alias in `apps/app/entrypoints/app/App.tsx` pointing at the MCP settings view (lower churn than repointing the Chromium patch at `chrome/browser/browseros/core/browseros_constants.h:70-72`). Move `QuickSetupSection` out from under `IntegrationsSection`'s Klavis gate in `screens/mcp-settings/MCPSettingsPage.tsx`; keep URL copy + `claude mcp add` snippets always visible. Consolidate: extract one tool-spec module per tool shared by `agent/tool-adapter.ts` (`buildBrowserToolSet`) and `packages/browseros-agent/packages/browser-mcp/src/tools/register.ts` (`registerBrowserTools`); delete the duplicate definitions.
> **How to test:** E2E — in the `pane` build, open `chrome://browseros/mcp` → MCP settings page; copy the command; run `claude mcp add pane …` from a terminal → Claude Code lists Pane tools. Unit — assert both loop and MCP build tool sets from the same spec (same schemas/handlers).

> **M1.7 — Process supervision basics** `[par]`
> **What:** The SW supervises the server; single-instance lock; CDP reconnect on tab/browser crash; degraded mode.
> **How to build:** SW (`entrypoints/background/index.ts`) health-checks `/health` and relaunches the server with backoff. Add a single-instance lock file under `~/.browseros/`. Server target registry with reconnect: per-tab CDP sessions reattach; in-flight run pauses on target gone; browser-crash → server marks degraded (browser tools unavailable, file/terminal/memory still work), SW relaunches browser, server reattaches. `/shutdown` drains in-flight runs cleanly.
> **How to test:** Integration — kill the server process → SW relaunches within backoff window; crash a tab mid-run → run pauses with "target gone", not error; kill the browser → server reports degraded, then recovers on relaunch. Unit — lock-file contention.

> **M1.8 — User-facing rebrand pass** `[par]`
> **What:** Every shipped user-facing surface says Pane (wordmark, mark, names, copy). Internal IDs stay as tech debt.
> **How to build:** Finish the rebrand using `assets/branding/` SVGs and `PaneMark`/`PaneWordmark` components across newtab, sidepanel, settings, onboarding, MCP page. Product name strings → "Pane". Leave `@browseros/*`, `chrome.browserOS`, `chrome://browseros/*`, storage keys as-is (tech debt).
> **How to test:** Manual screenshot sweep of every screen; no "BrowserOS" user-visible string remains (internal URLs/IDs excepted). Visual diff vs. the branding preview PNGs in `assets/branding/`.

> **M1.9 — Streaming-ASR de-risk spike (no user surface)** `[par]`
> **What:** Benchmark real-time meeting transcription on common laptops to decide Phase 6's ASR path. Decision gate: local streaming ASR usable → Phase 6 ships local default; not usable → Phase 6 ships meeting capture BYOK-only.
> **How to build:** Stand up a streaming/chunked ASR candidate (whisper.cpp streaming or `faster-whisper` chunked) + diarization on a mid-range laptop. Run a 30-min meeting sample; measure latency, accuracy (WER vs. a reference), CPU/battery. Record results + the go/no-go decision in `specs/`.
> **How to test:** The deliverable is the benchmark report + decision. Pass = a recorded WER/latency/battery number and a written go/no-go for Phase 6 M6.2.

> **M1.10 — Eval harness scaffold + browsing-quality baseline** `[par]`
> **What:** The eval harness (`apps/eval`) is extended with the scaffolding for the Pane-thesis eval (filled in Phase 7), and a browsing-quality CI gate captures the bare-browser latency baseline now.
> **How to build:** Add a config + dataset stub + grader skeleton to `apps/eval` (no dataset yet). Add the browsing-quality CI test: navigate + tab-switch with the graph off (baseline) and record latency; assert the harness runs green. The actual threshold-with-graph-on lands in Phase 3.
> **How to test:** CI — the browsing-quality baseline test runs green in CI. The eval skeleton executes a trivial case end-to-end.

---

# Phase 2 — Trust & Workspaces: Pane acts safely on your work

**Ship gate (Pane v0.2):** The agent can read/write files and run terminal commands inside user-scoped workspaces, gated by a trust framework (consequence classes derived from `(tool, args)`, dry-run for high-risk actions, a blast-radius cap for new users, a replayable action log, and an approval UI). A workspace switcher and file-browser UI land. This is "Pane does your work, safely."

> **M2.1 — Workspace object model (server)** `[seq]`
> **What:** `ResolvedAgentConfig.workingDir` (a path today) becomes a workspace object `{ root, scope, terminalPolicy, bucketId }`; the filesystem tool set and path sandbox consume it; a terminal denylist is added.
> **How to build:** In `apps/server/src/tools/filesystem/`, change `buildAgentFilesystemToolSet` to accept the workspace object. Extend `path-boundary.ts` with a terminal denylist + per-workspace `terminalPolicy`. Introduce `bucketId` here (the partition key Phase 3 reuses). `filesystem_bash` gains terminal session reuse (persist cwd, named sessions).
> **How to test:** Unit — path-boundary allows writes inside `root`, denies outside, denies denylisted terminal commands. Integration — via `/chat`, ask the agent to write a file in the workspace → succeeds; write outside → blocked by the gate (M2.2) before the FS call.

> **M2.2 — Trust gate at the tool chokepoint** `[seq → M2.1]`
> **What:** One gate every tool call passes (browser, filesystem, context, capture) that derives the consequence class from `(tool, args)` and enforces approvals/dry-run/blast-radius.
> **How to build:** Insert a trust gate in `apps/server/src/agent/` at the single chokepoint used by `ToolLoopAgent.prepareStep`. Declare consequence-class metadata on each tool in the consolidated tool-spec module (M1.6). Classes: `read` (free), `write-local` (first-time confirm, pinnable), `write-external`/`system`/`spend` (dry-run by default: draft-and-show / preview-exact-command / always-confirm). Blast-radius cap: one consequential action per run for new users, lifting as trust is pinned. Pins expire; `spend` never pinnable. External MCP clients and harness agents do not bypass the gate.
> **How to test:** Unit — `deriveClass(tool, args)` returns the right class for representative args (e.g. `filesystem_write` outside workspace → `system`; browser `act` on a payment form → escalated). Integration — a `write-external` call produces a draft, not an execution, until promoted. Property — a model-injected "you already have approval" in a tool result does not change the class.

> **M2.3 — Action log** `[seq → M2.2]`
> **What:** Every consequential action is recorded, replayable, and viewable.
> **How to build:** Add an `action_log` Drizzle schema module + migration under `lib/db/`; the gate writes one row per consequential action (tool, args, output, time, approval decision). A settings screen lists it with filters.
> **How to test:** Unit — gate writes a row on every consequential call. Integration — perform a dry-run + a promoted action → both rows present with correct decisions. Manual — open the action log screen, replay an entry.

> **M2.4 — Approval UI + dry-run preview** `[seq → M2.2]`
> **What:** The user approves/edits/promotes consequential actions through a clear UI; dry-run shows the exact effect before execution.
> **How to build:** App component rendered from the gate's pause signal in the sidepanel/newtab loop: draft-and-show for writes, exact-command preview for terminal/system, spend always-confirms. Promote / edit / deny actions. Ties into the tool transcript UI (don't rebuild it).
> **How to test:** Unit — component renders the right preview per class. E2E — trigger a `system` action → preview shown → promote → action executes and is logged (M2.3). Manual — approval-fatigue guardrail (deny+disable rate) re-tunes defaults.

> **M2.5 — Terminal session reuse** `[par → M2.1]`
> **What:** Named, reusable terminal sessions per workspace; cwd persists; sessions surface as future graph nodes (hook ready for Phase 3).
> **How to build:** In `filesystem_bash`, persist sessions per workspace under `~/.browseros/`; add a session list + switch. Emit a pluggable `onTerminalSession` event (Phase 3's ingest subscribes).
> **How to test:** Integration — run a command changing cwd in session A, reopen A → cwd preserved; open a new named session B → independent. Unit — event emitted with session metadata.

> **M2.6 — Multi-workspace UI + file browser** `[par → M2.1]`
> **What:** Users manage a *set* of workspaces with scopes + a switcher, and browse files in the active workspace.
> **How to build:** Extend `workspace-storage.ts` from a single `selectedWorkspace` to a set; add a `Workspaces` screen + sidebar switcher (new `screens/workspaces/`); build the file-browser UI on the existing folder-picker primitive.
> **How to test:** Unit — storage add/remove/switch. E2E — create a workspace pointing at a folder, switch to it, browse files, ask the agent to read one → reads from the right root. Manual — visual sweep.

> **M2.7 — Trust-invariant test suite** `[par]`
> **What:** The security invariants are continuously tested.
> **How to build:** A dedicated suite asserting `deriveClass(tool, args)` correctness across tool/arg combinations, and that the instruction channel rejects injected instructions (captured/tool-result data cannot rewrite the system prompt or auto-approve).
> **How to test:** This *is* the test; it runs in CI and must stay green. Fuzz-style cases for path escalation and form-target escalation.

---

# Phase 3 — Context Graph & Tasks: Pane knows your work, tracks follow-ups

**Ship gate (Pane v0.3):** Pane indexes browser/files/terminal/scheduled activity into a queryable, bucketed Context Graph; `context.current_work` / `context.search` / `context.recall` work in the loop and over MCP; a Context panel shows "what Pane knows right now"; a Tasks inbox with triage and one-click "save as scheduled." The browsing-quality gate now runs with the graph on and stays within budget.

> **M3.1 — Graph store** `[seq]`
> **What:** Extend `browseros.sqlite` with the graph schema + FTS5 index (one client, one migration path).
> **How to build:** Add Drizzle schema modules under `lib/db/schema/` for `graph_nodes`, `graph_edges`, `graph_events`, `buckets`, and an FTS5 virtual table `graph_index`; a forward-only migration. Fix the `produced_files` pattern (M1.5) as the template. Every node/edge carries `bucket_id`, `provenance`, timestamps.
> **How to test:** Unit — schema round-trip; FTS5 insert/query. Integration — ingest 1000 events → queryable within latency budget.

> **M3.2 — Event ingest** `[seq → M3.1]`
> **What:** Tool calls (browser, filesystem, scheduled) emit graph events; no new extraction pipeline.
> **How to build:** Add a post-tool hook in the tool path (after results return) that writes a graph event + node/edge. Subscribe the terminal-session hook from M2.5. Incognito/private windows never ingested.
> **How to test:** Unit — hook emits a well-formed event per tool result. Integration — a browser nav + a file write + a terminal command each produce nodes/edges; an incognito nav produces none.

> **M3.3 — Bucket model + Context panel** `[seq → M3.1]`
> **What:** Buckets partition the graph; a Context panel shows current knowledge and per-domain grants.
> **How to build:** Bucket assignment + a `#/context` route with a per-domain grant model (feeds the trust panel) and a bucket switcher. Grants are the user-facing permission surface for what Pane may read.
> **How to test:** Unit — bucket filtering on retrieval. E2E — grant domain A, deny B → search returns A's nodes only. Manual — Context panel renders "what Pane knows" accurately.

> **M3.4 — Context tools (single spec, /chat + /mcp)** `[seq → M3.1]`
> **What:** `context.current_work`, `context.search` (FTS5 snippets), `context.recall` (memory-backed, wired in Phase 4) available in-loop and over MCP.
> **How to build:** Define each tool once in the consolidated tool-spec module (M1.6); register in the in-process builder and the MCP server. `context.search` returns snippets, not documents (prompt budget).
> **How to test:** Unit — tool specs identical for loop and MCP. Integration — via `/chat`, "what was I working on in <workspace>" returns current_work; a search returns ranked snippets. E2E — Claude Code over MCP calls `context.search` and gets results.

> **M3.5 — Tasks + inbox/triage UI** `[par → M3.1]`
> **What:** A Tasks layer: `tasks` + `task_links` tables; an inbox/triage UI; one-click promote to scheduled job.
> **How to build:** Add `tasks`/`task_links` schema + migration; new `screens/tasks/`. A task links to graph nodes (M3.1). "Save as scheduled" reuses the existing nudge→scheduled-job concept. Distinct from scheduled *jobs* (the runtime) — tasks are the user-facing inbox, jobs are execution.
> **How to test:** Unit — task CRUD + link to a graph node. E2E — create a task, promote to scheduled → a scheduled job appears and fires. Manual — triage inbox UX.

> **M3.6 — Wedge wiring: CLI `context`/`tasks`** `[par]`
> **What:** The Go CLI gains `context` and `tasks` command groups; the new tools are exposed on `/mcp`.
> **How to build:** Extend `apps/cli/cmd/root.go` with `context search|current` and `tasks list|add|done` subcommands hitting local MCP. Confirm `context.*` and `tasks.*` appear in the MCP tool list.
> **How to test:** E2E — `pane context search "deploy"` returns results; `pane tasks add "fix bug"` then `pane tasks list` shows it.

> **M3.7 — Graph performance budget** `[par]`
> **What:** Indexing is cadenced/batched, idle-priority, pauses on battery; the browsing-quality gate now runs with the graph on.
> **How to build:** Batch graph writes; idle-priority indexing; pause-on-battery hook. Turn on the browsing-quality CI test with the graph on; set the latency threshold vs. the Phase 1 baseline (e.g. within X%).
> **How to test:** CI — browsing-quality-with-graph green. Manual — on battery, indexing pauses with a visible state.

---

# Phase 4 — Memory & Skills: Pane becomes smarter

**Ship gate (Pane v0.4):** Pane persists memory (5 layers, files + SQLite index), recalls it in-loop, and auto-creates skills from repeated successful workflows (staged per the approval default), with a curation loop that prunes unused skills and stale memory. The prompt budget is enforced.

> **M4.1 — Memory store** `[seq]`
> **What:** Files under `~/.browseros/memories/` (`soul.md`, `MEMORY.md`, `USER.md`, per-topic) + a `memory_entries` SQLite table (id, layer, bucket, content char-bounded, `last_surfaced`, `usefulness`).
> **How to build:** New `@browseros/memory` package + `apps/server/src/memory/`. Files keep memory inspectable/editable; the index gives fast prompt loading. `soul.md` is the persona/identity layer (see M4.7). Memory survives DB corruption (files are the source of truth, index is rebuildable — §6.2).
> **How to test:** Unit — write memory → file + index row; delete index → rebuild from files. Integration — corrupt the SQLite file → memory still readable from files.

> **M4.2 — `context.recall` + prompt budget** `[seq → M4.1]`
> **What:** Memory retrieval is a context tool; a fixed token budget with eviction is enforced across `current_work` / search / memory / skill-index.
> **How to build:** Wire `context.recall` (from M3.4) to the memory index. Implement the prompt-budget allocator: char/token caps per slot, eviction oldest/lowest-`usefulness` first. Skill index (names + one-liners) in prompt, bodies on demand.
> **How to test:** Unit — budget allocator evicts correctly when over cap. Integration — load a large memory + graph → assembled prompt stays under budget; recall returns ranked, char-bounded entries.

> **M4.3 — Auto-skill review job** `[seq → M3.1]`
> **What:** A background job drafts skills from repeated successful workflows, behind an extraction bar, staged per approval default.
> **How to build:** A queued job on the scheduled-tasks runtime (don't build a second scheduler). It reads a **bounded rolling window** of graph events + runs, and only proposes a skill when a workflow repeats with successful outcomes above a threshold (existing `min_tool_calls` + a repeat count). A cheaper model drafts `SKILL.md` patches; drafts below the bar are discarded. Stage per `write_approval` default (conversation-derived writes free + notify; inferred/capture-derived stage). Pause-on-battery.
> **How to test:** Unit — extraction bar: a single occurrence → no draft; N repeated successes → draft. Integration — feed a synthetic repeated workflow → a staged skill appears (not auto-applied). Property — bounded window: large history does not blow up review input.

> **M4.4 — Skill store + index** `[seq → M4.3]`
> **What:** Skills as `~/.browseros/memories/skills/*.md` (agentskills.io format) + a `skills` table (name, description, provenance, `source_run`, `uses`, `success_rate`, `status`); skill index in prompt, bodies on demand.
> **How to build:** Persist drafted skills; load the index (names + one-liners) into the prompt; bodies load on demand (the Hermes "no heavy backpack" lesson). `MarketplaceSource` interface (local default: own-skills + agentskills.io import-by-URL/file; no hosted directory).
> **How to test:** Unit — skill file ↔ index row. Integration — a loaded skill's body is fetched only when invoked. E2E — import an agentskills.io skill by URL → appears in the index, invokable.

> **M4.5 — Curation (anti-bloat) loop** `[par → M4.4]`
> **What:** Use-tracking demotes then archives unused skills; stale memory is demoted out of the always-on prompt (still searchable); a monthly curation digest is emitted.
> **How to build:** `uses=0` after N days → archived; `success_rate` below threshold over K uses → flagged then archived. Memory entries never recalled lose always-on prompt slot (still searchable). Emit a monthly digest via the proactive engine stub (fully wired in Phase 5).
> **How to test:** Unit — demotion rules. Integration — a skill unused for N days → archived; a recalled memory stays in the prompt, an unrecalled one drops out but remains searchable.

> **M4.6 — Wedge + UI for memory/skills** `[par]`
> **What:** CLI `memory` commands; memory/skill tools on `/mcp`; a Memory & Skills management UI.
> **How to build:** CLI `memory recall|add|forget` and `skills list|install|archive`. Register memory/skill tools on `/mcp`. A settings screen to view/edit memory files, approve/reject staged skills, import skills.
> **How to test:** E2E — `pane memory add "prefers tabs over spaces"` → recalled in a later run. Manual — approve a staged skill in the UI → it becomes invokable.

> **M4.7 — `soul.md` persona layer** `[par → M4.1]`
> **What:** Pane's identity and active persona live in a plain, editable `~/.browseros/memories/soul.md` injected into the system prompt; the persona can follow the active context bucket; persona shifts are suggested (gated), never silent. This is the "browser with a soul / becomes whatever you need it to be" file (specs [11](./11-personalization-skills-marketplace.md), [00](./00-vision-and-thesis.md)).
> **How to build:** Seed `soul.md` in onboarding from the ICP answer (dev / research / personal-automation / privacy) into a named persona (chief of staff / job-search partner / research buddy / custom) with voice + boundaries + what-it-watches-for. Ship 3–4 persona templates the user can adopt/tweak/rewrite. Wire the active-bucket → active-persona mapping (switch bucket → persona shifts, unless pinned). Add a persona-shift proposer: when the memory loop (M4.3) detects a sustained change in work patterns, it proposes a `soul.md` edit staged per `write_approval`. A `/settings/personalization` screen edits `soul.md`/`USER.md`. All persona edits are visible in the memory UI.
> **How to test:** Unit — bucket → persona mapping; pinned override. Integration — switch bucket → `soul.md` active persona changes in the assembled prompt; a detected pattern → a staged persona-shift proposal appears (not auto-applied). E2E — edit `soul.md` to "be terse, no emojis" → Pane's voice changes in the next run. Manual — onboarding seeds a non-default persona and it persists.

---

# Phase 5 — Proactive & Reach: Pane works for you, even away

**Ship gate (Pane v0.5):** Pane runs graph-event-triggered and scheduled jobs, emits a daily digest, stays alive at login (macOS), and reaches you out-of-browser (OS push, your SMTP/IMAP, Telegram) including approve/deny over channel. Scheduled jobs are idempotent and recover from mid-run crashes. The **adaptive home** shows the digest and your-day widgets on the new tab, persona/bucket-shaped.

> **M5.1 — Trigger engine** `[seq]`
> **What:** Triggers subscribe to graph events (not just time) and fire runs.
> **How to build:** A trigger engine in `apps/server/src/scheduler/` subscribing to graph events (M3.2); rules like "on Nth occurrence of X, run Y." Reuses the scheduled-tasks runtime for execution.
> **How to test:** Unit — rule matches an event → fires. Integration — emit a matching graph event → a run starts with the right prompt.

> **M5.2 — Daily digest** `[seq]`
> **What:** A first-class scheduled output: the habit-loop driver, assembled from memory + graph.
> **How to build:** A daily scheduled job that summarizes recent graph activity + memory + pending tasks (M3.5) into a digest, delivered via reach (M5.4) and shown on the new-tab home. This is the retention loop's core.
> **How to test:** Integration — at the scheduled time, a digest is produced with real graph/memory content. Manual — digest renders on new-tab home and (when reach is on) arrives out-of-browser.

> **M5.3 — macOS keep-alive** `[par]`
> **What:** At login, the server runs always; a minimal browser process runs lazily for browser-jobs; never the full UI.
> **How to build:** A `launchd` LaunchAgent starting the server at login. `KeepAliveService` interface (§12) with the macOS impl. For jobs needing browser tools, lazily launch a minimal Chromium (no extension window), tear down after idle. Honest limitation stated in-product: a browser-job won't fire on a closed laptop; non-browser work fires whenever the machine is awake.
> **How to test:** Integration — log out/in → server up without UI; a non-browser scheduled job fires while the browser is closed; a browser-job launches the minimal browser, runs, tears down. Manual — battery/resource impact acceptable.

> **M5.4 — Reach transports** `[seq → M2.2]`
> **What:** Three peer-to-peer transports, none Pane-operated: OS push, the user's own SMTP/IMAP, Telegram bot.
> **How to build:** A `@browseros/reach` module behind a `ReachTransport` interface. OS native push; SMTP/IMAP with credentials in the secure store (like OAuth tokens today); Telegram bot that polls Telegram's API and sends, with inbound commands routing to the loop.
> **How to test:** Unit — each transport's send/poll. Integration — send a test push/email/Telegram message → arrives; reply via Telegram → routes to the loop. Manual — configure SMTP creds, receive a digest.

> **M5.5 — Approval-over-channel** `[seq → M5.4]`
> **What:** A gated action needing approval while the user is away pauses and sends a reach message with an approve/deny deep link; never auto-approves.
> **How to build:** Wire the trust gate's pause (M2.2) to reach: on an unattended gated action, send an approve/deny message; the run pauses; an approved deep link resumes, deny cancels.
> **How to test:** E2E — a scheduled `write-external` while away → reach message sent → run paused → approve via link → action executes and is logged; deny → run cancelled.

> **M5.6 — Scheduled-task idempotency** `[par]`
> **What:** A partially-completed run doesn't re-run from scratch and duplicate side effects.
> **How to build:** Each run carries an idempotency key + a checklist of completed tool calls; extend `scheduledJobRuns` with per-step completion; on retry, resume after the last confirmed step; `write-external`/`spend` deduped by key.
> **How to test:** Integration — crash a run mid-way → retry skips done steps, completes the rest; no duplicated external effects.

> **M5.7 — Adaptive home (evolving new-tab widgets)** `[seq → M4.7, M5.2]`
> **What:** The new tab becomes the surface where soul + memory + graph + tasks + proactive become visible: widgets (daily digest, next meeting, resumed work, pending approvals, one-click recurring, research thread) ranked by your activity rhythms and shaped by the active `soul.md` persona + bucket, with a calm day-1 fallback. Spec [15](./15-adaptive-home.md).
> **How to build:** Extend the existing `entrypoints/app` new-tab/home surfaces (`NewTabBranding`, `NewTabChat`, `AgentCommandHome`, personalize) into a widget host — no new entrypoint. A home engine queries local state (graph M3.1/3.3, memory M4.1, tasks M3.5, digest M5.2, soul M4.7) and selects/orders widgets by activity-memory rhythms (layer 4) × persona/bucket relevance, with hysteresis so widgets don't jump. Each widget carries a one-line "why this is here" and pin/hide/dismiss; dismissals write a preference to `USER.md`. Pre-compute LLM content (digest summaries) via the proactive engine and cache — never an LLM call at tab-open. Day-1 fallback: most-visited (from import) + chat composer + "summarize this page" when the graph/persona have nothing yet.
> **How to test:** Unit — widget ranking (persona + rhythm + hysteresis); dismiss → preference written. Integration — at 9am with a meeting + pending PRs + a Friday-cadence skill → the right widgets render in order; switch bucket → widget set reshapes. Perf — home renders <150 ms on open with no LLM call (cached content). Manual — day-1 fallback renders for a new user; capture disabled → meeting widgets absent, home degrades cleanly.

---

# Phase 6 — Passive Capture & Buckets: the flagship intrinsic

**Ship gate (Pane v0.6):** Pane captures meetings (audio + page content → streaming transcript + diarization, or BYOK per the M1.9 decision) and learns from browsing (opt-in, per-domain) into scoped context buckets, with an always-visible consent glow. (If M1.9 said local ASR is unusable, meeting capture ships BYOK-only — still a complete feature; browsing learnings are unaffected.)

> **M6.1 — Native tab-audio + capture primitive** `[seq]`
> **What:** A Chromium-fork primitive captures tab audio + page content; the glow indicator becomes the capture light.
> **How to build:** Add a `browseros.captureTabAudio` + page-content stream primitive in `packages/browseros/chromium_patches/` (the fork is what makes this possible; MV3 `tabCapture` is unreliable). Repurpose the glow indicator as the always-visible capture light. Expose the stream to the server.
> **How to test:** Unit (fork) — primitive yields an audio stream + DOM snapshot for a given tab. Manual — glow lights while capturing, off otherwise.

> **M6.2 — Meeting capture pipeline** `[seq → M6.1]`
> **What:** Meeting capture = tab audio + page content (participants/chat/shared docs via existing extractors) → streaming transcript + diarization, with a `TranscriptionProvider` interface (local default or BYOK per M1.9).
> **How to build:** A `@browseros/capture` module. Streaming/chunked ASR (VAD → rolling chunks → partial transcripts) + diarization; `TranscriptionProvider` with a local impl (if M1.9 go) or BYOK-only (if no-go). Recordings/transcripts stored under `~/.browseros/capture/` per bucket.
> **How to test:** Integration — capture a 10-min test meeting → transcript with speaker labels within the benchmarked latency/accuracy. Manual — transcript + notes render and are searchable via `context.search`.

> **M6.3 — Browsing learnings + research bucket** `[seq → M3.1]`
> **What:** Passive, opt-in, per-domain observation feeds facts/workflows to the memory loop; research auto-threading records the page chain with verbatim quotes for citable retrieval.
> **How to build:** Observe page content (reuse `browser-mcp` extractors) on opted-in domains; extract facts/workflows → feed the M4.3 review job. Research bucket: record the page chain + verbatim quotes; bucket assignment inferred from domain, shown, reassignable — never silent.
> **How to test:** Integration — browse an opted-in domain → a learning appears staged in memory; a research thread records quotes retrievable via `context.search` with citations.

> **M6.4 — Capture consent + untrusted-input handling** `[seq]`
> **What:** Capture is OFF by default; per-class + per-domain opt-in; glow indicator; bucket-scoped storage; captured content is untrusted input.
> **How to build:** Consent model: each capture class + each domain opted in separately; glow always visible while capturing; storage bucket-scoped with per-bucket retention (raw recordings short, transcripts longer). Captured content enters the loop only as tool-result data, never as instructions (§4.0 — structural injection defense).
> **How to test:** Property — captured content placed in a tool result cannot rewrite the system prompt or auto-approve an action (covered by M2.7 invariants extended to capture). Integration — capture off by default; enabling one domain captures only that domain.

> **M6.5 — Capture UI** `[par]`
> **What:** Meetings list + transcript/notes; bucket manager; visible "capture paused" states.
> **How to build:** A Capture screen (`screens/capture/`) listing meetings with transcript/notes, plus a bucket manager (shared with M3.3). Pause states for battery/under-load/disk-low.
> **How to test:** Manual — open a past meeting → transcript + notes; reassign a bucket; trigger disk-low → "capture paused" state.

> **M6.6 — Capture performance budget** `[par]`
> **What:** Capture + transcription are the heaviest intrinsic consumers; cadenced extraction, pause on battery/under-load, retention enforcement.
> **How to build:** Cadence extraction; pause hooks (battery/load/disk); prune oldest raw recordings per retention. A disk-near-full → capture-paused state.
> **How to test:** Integration — low battery → capture pauses with visible state; disk near-full → raw recordings pruned, capture pauses.

---

# Phase 7 — Page Reshape & Overlays: the web, reshaped for you

**Ship gate (Pane v0.7):** Pane can reshape pages you opt in for: your-context overlays (job-fit scores against your resume, calendar-fit highlights, margin notes tied to your project) and feed de-slop on 2–3 named feeds (LinkedIn / X / Hacker News). Every overlay is Pane-branded, reversible, dismissible, per-domain consented, and never silently writes to a site. Dismiss/hide/expand signals feed the memory loop so reshaping improves over time.

> **M7.1 — Reshape consent + overlay isolation** `[seq → M2.2]`
> **What:** The trust foundation for reshaping: per-domain opt-in (defaults off for banking/payments/health/government), a first-encounter enable prompt, and isolated overlays a hostile page can't read or impersonate.
> **How to build:** A per-domain consent store (reuses the per-domain grant model from M3.3). A Pane-owned overlay root in an isolated content-script world (the page can't read your context digest or trick the overlay). Overlays are always Pane-branded ("added by Pane") and never impersonate site UI. Reshape never edits form values / posts / submitted data — any write goes through the M2.2 gate.
> **How to test:** Property — a hostile page script cannot read the overlay's context digest or alter the overlay; submitted form values are untouched by reshape. Unit — defaults off for protected domains; first-encounter prompt fires once per domain. Integration — enable domain A → reshape runs; domain B → none.

> **M7.2 — Annotation overlays (your-context on a page)** `[seq → M7.1]`
> **What:** Pane reads a page in the context of *your* goals and layers your-fit / your-context on top: a fit score on a job listing (from your workspace resume), calendar-fit highlights on a flight search, margin notes on a long doc tied to your active project.
> **How to build:** A reshape job (cheap model, BYOK allowed; local-only users get a degraded annotation experience, honestly hidden when the local model is too weak) gets a compact page digest + your-context digest (`soul.md` M4.7 persona + active bucket M3.3 + `USER.md`/`MEMORY.md` M4.1 + granted workspace files M2.1 + calendar via integrations M9-style) and returns overlay intents (annotation / highlight / sidebar-note). Per-URL cache; no page content leaves the machine beyond the model call.
> **How to test:** Integration — on an opted-in job listing with a granted resume → a Pane fit-score card renders with a one-tap dismiss + "wrong? report"; on a flight page with calendar connected → calendar-fit routes highlighted. Unit — cache hit skips the model call. Manual — report-wrong kills the reshape for that URL.

> **M7.3 — Feed de-slop (LinkedIn / X / Hacker News)** `[seq → M7.1, M6.3]`
> **What:** On a feed, Pane learns what you consider noise vs. signal and collapses/dims the noise while keeping the signal — original order one tap away.
> **How to build:** A local "signal vs. noise" classifier per feed, trained on your expand/hide/dwell signals from browsing learnings (M6.3). On load, apply the classifier to visible items first, then lazily on scroll (never blocks first paint). Noise is *collapsed* with a "show what Pane hid" affordance, never deleted. Reorder is feed-only, original order one tap away.
> **How to test:** Integration — on an opted-in feed, recruiter-spam/engagement-bait items collapse while posts from people you expand stay; "show what Pane hid" re-expands. Property — first paint not blocked (lazy on scroll). Unit — classifier preference stored to memory; a hide on LinkedIn recruiter spam → `USER.md`/feed preference written.

> **M7.4 — Reshape learning loop + performance budget** `[par → M7.2, M7.3]`
> **What:** Dismiss/hide/expand/pin signals flow back to memory so reshaping improves; reshapes are lazy and rate-limited and pause on battery.
> **How to build:** Wire dismiss/hide/expand/pin → memory writes (gated per M4.1 approval defaults) that tune the feed classifier and annotation ranking over time. Lazy gating: a reshape runs only if domain opted-in AND the active persona/bucket makes a relevant reshape available. Cache per-URL; pause on battery/low-resource (glow shows "reshape paused").
> **How to test:** Integration — dismiss a fit score on a site → never shown there again + preference in memory; repeated hides of a feed item type → that type ranks as noise next load. Manual — on battery, reshapes pause with a visible state; heavy/infinite feeds don't block first paint.

> **M7.5 — Reshape UI + home hint** `[par → M7.2, M5.7]`
> **What:** The user manages reshape: per-domain toggles, "show what Pane hid," a per-page "disable for this site," and the adaptive home surfaces a reshape hint when the active page can be reshaped.
> **How to build:** A `/settings/reshape` screen (per-domain consent list, defaults, "show hidden" global toggle). The adaptive home (M5.7) renders a "this page can be reshaped — enable?" hint card when a reshape is available for the active tab. A page-level Pane control to disable for the current site.
> **How to test:** E2E — open an opt-in-eligible page → home hint appears → enable → overlay renders; disable-for-this-site → overlay removed and consent revoked for that domain. Manual — settings list shows per-domain state and "show hidden" works.

---

# Phase 8 — Cross-platform, packaging & polish: Pane for everyone

**Ship gate (Pane v1.0):** Signed, notarized, auto-updating Pane on macOS, Windows, and Linux, with patch-discipline CI, a local diagnostics surface, the full testing strategy, and the Pane-thesis eval as the credibility artifact.

> **M8.1 — Platform interfaces + Windows impl** `[seq]`
> **What:** The OS primitives (§12) behind interfaces, with a Windows implementation.
> **How to build:** Land `KeepAliveService`, `NotificationSink`, `CredentialStore`, `CdpTransport` interfaces (consumed by M5.3/M5.4/M1.4). Windows impls: Task Scheduler on-logon, Windows toast, Credential Manager/DPAPI, named pipe for CDP.
> **How to test:** Integration (Windows VM) — keep-alive at login, OS notification, credential round-trip, CDP over named pipe.

> **M8.2 — Linux impl** `[par]`
> **What:** systemd user unit, libnotify, libsecret, Unix-socket CDP.
> **How to build:** Linux impls of the same interfaces. Accept community PRs against them.
> **How to test:** Integration (Linux) — keep-alive via systemd user unit, notifications via libnotify, credentials via libsecret, CDP over Unix socket.

> **M8.3 — Code-signing + notarization in CI** `[seq]`
> **What:** Nightly/release builds are signed and notarized.
> **How to build:** Wire macOS Developer ID + notarization and Windows Authenticode into `nightly-macos-build.yml` / `nightly-release.yml` (community-funded certs — an OSS cost, not a server cost).
> **How to test:** CI — a signed build verifies on a clean macOS/Windows install without warnings.

> **M8.4 — Signed auto-update manifests** `[seq]`
> **What:** Auto-update works without a Pane product server, from a static host.
> **How to build:** Sparkle on macOS (signed manifest on a static host / GitHub Releases); WinSparkle or custom signed manifest on Windows; AppImageUpdate/zsync on Linux. Verify-and-swap on next launch. The update server is a *static file host*, never a control plane.
> **How to test:** E2E — publish a signed manifest on the static host → an installed Pane updates itself on next launch.

> **M8.5 — Patch-discipline CI** `[par]`
> **What:** The Chromium rebase treadmill is sustainable: small patch series, auto-rebase detection, upstream tests on patched areas.
> **How to build:** Organize the fork's diff as a `patches/` series tagged with owner + rationale; a scheduled CI job attempts an auto-rebase against upstream stable; on rebase, run the Chromium test suites for the patched `browseros_*` areas. Prefer upstreaming generally-useful pieces.
> **How to test:** CI — the auto-rebase job runs on schedule and reports drift; a rebase runs the patched-area test suites green.

> **M8.6 — Local diagnostics surface** `[par]`
> **What:** The user is the operator; they get a local dashboard.
> **How to build:** A `#/diagnostics` route: server/CDP/browser health, model connectivity, last error, `~/.browseros/` disk usage, the action log (M2.3), curation digest (M4.5), capture consent state, per-bucket retention. Self-service: export my data, wipe index, reset onboarding. Local logs to `~/.browseros/logs/` with rotation.
> **How to test:** Manual — diagnostics renders real values; "export my data" produces a tarball; "wipe index" clears the graph and rebuilds from durable sources (memory files survive).

> **M8.7 — Full testing strategy** `[seq]`
> **What:** Unit, integration, browsing-quality, trust-invariant, and Chromium-fork tests all run in CI.
> **How to build:** Unit per-package (Vitest, existing); an integration suite that boots the Bun server + headless Chromium (CDP) and exercises the loop through `/chat` and `/mcp`; the browsing-quality gate (M3.7); the trust-invariant suite (M2.7); Chromium-fork tests on rebase (M8.5).
> **How to test:** CI — the full suite is green on every PR.

> **M8.8 — Pane-thesis eval** `[seq]`
> **What:** The end-to-end eval proving the moat: browser + workspace + context + capture in one flow.
> **How to build:** Fill in the Phase 1 eval scaffold (`apps/eval`) with a real config + dataset + grader: a multi-step task that browses, reads/writes workspace files, recalls context, and captures a meeting artifact. This is the internal proof and the public credibility artifact.
> **How to test:** The eval runs and scores above the set bar in CI; regressions fail the build.

---

## Cross-cutting rules (apply throughout)

- **One tool spec** (M1.6) — every new tool in Phases 2–7 is defined once and consumed by both loop and MCP.
- **State ownership** (§6) — heavy state server-side; app holds only prefs + alarm spec.
- **Prompt budget** (M4.2) — enforced from Phase 4 onward; snippets, not documents.
- **Trust gate** (M2.2) — every new tool declares its consequence class and passes the gate.
- **No Pane servers** — every extension point (`SyncAdapter`, `MarketplaceSource`, `RunnerAdapter`, `ReachTransport`, `TranscriptionProvider`, `MemoryProvider`, `CreditsProvider`, `TaskSync`) ships with a local no-op/default. No module calls a Pane endpoint.
- **Frequent commits** — each module is a series of small, tested commits.

---

## Self-review

**1. Spec coverage (against `ARCHITECTURE-DESIGN.md` §4 subsystems + the "becomes yours" surfaces):**
- Context Graph + buckets → Phase 3 (M3.1–M3.4, M3.7). ✔
- Memory + auto-skill loop + curation → Phase 4 (M4.1–M4.5). ✔
- **`soul.md` persona layer** → Phase 4 (M4.7). ✔
- Workspaces + terminal → Phase 2 (M2.1, M2.5, M2.6). ✔
- Tasks + executable tasks → Phase 3 (M3.5). ✔
- Proactive + scheduled + keep-alive → Phase 5 (M5.1–M5.3, M5.6). ✔
- Reach → Phase 5 (M5.4, M5.5). ✔
- **Adaptive home (evolving widgets)** → Phase 5 (M5.7). ✔
- Passive capture + buckets → Phase 6 (M6.1–M6.6). ✔
- **Page reshape & overlays** → Phase 7 (M7.1–M7.5). ✔
- Trust framework → Phase 2 (M2.2–M2.4, M2.7); reshape trust → Phase 7 (M7.1). ✔
- Dev surface wedge → Phase 1 (M1.6), Phase 3 (M3.6), Phase 4 (M4.6). ✔
- Process model / supervision / CDP security → Phase 1 (M1.4, M1.7). ✔
- State ownership + session persistence → Phase 1 (M1.5). ✔
- Platform matrix → Phase 8 (M8.1, M8.2). ✔
- Disable & cleanup register → Phase 1 (M1.1, M1.2, M1.3). ✔
- Build/packaging/update + patch discipline → Phase 8 (M8.3–M8.5). ✔
- Telemetry & quality + eval → Phase 1 (M1.3, M1.10) + Phase 8 (M8.7, M8.8). ✔
- Loop discipline (prompt budget, computed consequence, instruction channel, single tool spec) → threaded across M1.6, M2.2, M2.7, M4.2. ✔

**2. Dependency check:** 2 needs 1 (build profile, tool spec, CDP, sessions); 3 needs 2 (workspace `bucketId` + trust gate); 4 needs 3 (graph feeds the loop); 5 needs 2 + 4 (trust/approvals + memory/soul for digest + home); 6 needs 3 + 4 (buckets + memory loop); 7 needs 3 + 4 + 2 (graph + memory/soul + trust/workspace for reshape); 8 needs all. The M1.9 ASR spike informs M6.2's path. No cycle.

**3. Ship-gate completeness:** every phase gate names a product with complete features, not partial scaffolding. Phase 1 ships a usable browser+agent+wedge; Phase 2 adds safe acting; Phase 3 adds knowledge+tasks; Phase 4 adds memory+skills+`soul.md`; Phase 5 adds proactive+reach+the adaptive home; Phase 6 adds capture; Phase 7 adds page reshape & overlays; Phase 8 makes it signed/cross-platform. No phase ends on invisible infrastructure without a user surface.

**4. Placeholder scan:** no "TBD"/"implement later"; every module names real substrate paths and concrete test signals.

---

## Execution handoff

Plan complete and saved to `specs/IMPLEMENTATION-PLAN.md`. Two execution options:

1. **Parallel Execution** — split independent (`[par]`) modules across workers within a phase, with review between modules; phases run sequentially.
2. **Inline Execution** — execute modules in this session with checkpoints at each phase's Ship Gate.

Which approach?
