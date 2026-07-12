# Phase 7 — Pane v1.0: Polish, Correctness & Launch Readiness

> **For the agent:** This is Pane Phase 7. You are working on an existing codebase that has shipped six complete phases. Your job is not to build new features. It is to make the existing system **ready to ship to real users for the first time**. That means: the UI and UX are coherent and feel intentional; every feature that was built actually works end to end; there are no placeholder states, hacks, or dead code visible to the user; the product can be installed, updated, and run on macOS, Windows, and Linux without needing a Pane server; and there is a credible public eval proving the system does what it claims.
>
> This phase is the **v1.0 gate**. Everything here is about quality, correctness, and distribution — not capability.

---

## Context: what has shipped (Phases 1–6)

Read the phase reports (`specs/PHASE-1-REPORT.md` through `specs/PHASE-6-REPORT.md`) and walk the codebase before touching anything. Here is a summary of what exists:

**Phase 1 (Bedrock):** Pane build profile with cloud surfaces disabled; session persistence (server SQLite SoT); Pane-as-MCP wedge; CDP secured to loopback + token; telemetry gated; eval scaffold.

**Phase 2 (Trust & Workspaces):** Consequence classes + trust gate (single path for loop + MCP); approval UI (approve / deny / edit / promote); blast-radius cap; action log (SQLite `action_log`, `#/settings/action-log`); workspaces with path sandboxing; `#/workspaces` UI.

**Phase 3 (Context Graph & Tasks):** Context graph + FTS5 (`@browseros/context-graph`); context buckets; domain grants; `context_*` tools; tasks inbox + executable tasks; `#/context` and `#/tasks` UI; CLI `context` and `tasks` commands; battery-aware ingest pause.

**Phase 4 (Memory & Skills):** Memory file store (`~/.browseros/memories/`) with SQLite index; `context_recall` live (not stub); `SOUL.md` persona layer; `USER.md` profile; auto-skill review job (6h server interval); skill store + `skills_*` tools; prompt budget; curation/pruning; `#/settings/memory` UI; ICP onboarding seed → persona; URL skill install.

**Phase 5 (Proactive & Reach):** Graph-event trigger engine; daily digest (template assembler); macOS keep-alive (LaunchAgent + `--server-only`); reach transports (OS push, SMTP, Telegram); approval-over-channel; idempotency (`scheduledRunId` + `stepFingerprint`); adaptive home foundation (`/scheduler/home` + `AdaptiveHomeWidgets.tsx` + `HomeEngine.ts`); Scheduled Tasks page with Triggers panel.

**Phase 6 (Passive Capture & Buckets):** Native Chromium tab audio capture (`captureTabAudio` / `stopCaptureTabAudio` / `getCaptureStatus` in fork); offscreen MV3 audio mix; faster-whisper ASR sidecar (incremental, clip-timestamps, backpressure); meeting pipeline (JSONL transcripts, graph nodes, meeting bucket); browsing learnings observer; research threads; consent model (off-by-default, domain-level); draggable recording bubble; `#/capture` two-panel UI.

**What is already present but needs Phase 7 work:**
- macOS keep-alive binary path has a `TODO: finalize path` in release mode
- Windows and Linux keep-alive report `implemented: false`
- The release workflow (`release-browser.yml`) produces unsigned builds; signing infrastructure and `SPARKLE_PRIVATE_KEY` are wired but not enforced
- The pane-thesis eval (`apps/eval/pane-thesis/`) is a stub with two trivial browsing-quality scenarios — not a real Pane-thesis eval
- No `#/settings/diagnostics` route exists
- The test CI (`test.yml`) does not include the capture suite or trust-invariants in its matrix; it runs `server-api` which has known failures (`tests/api/services/klavis/*`)
- `com.browseros.agent-server` label is used in the LaunchAgent plist (should become `com.pane.agent-server`)

---

## What Phase 7 delivers

Phase 7 makes Pane v1.0 shippable. The work falls into five areas.

---

### 1. UX and UI quality audit across all six phases

Walk every route in the app (`/home`, `/connect-apps`, `/workspaces`, `/context`, `/capture`, `/tasks`, `/scheduled`, `/settings/ai`, `/settings/mcp`, `/settings/customization`, `/settings/action-log`, `/settings/memory`, `/settings/reach`, and the onboarding flow) with the mindset of a first-time user who has never seen BrowserOS.

For each screen, verify:

- **Feature completeness:** every UI element that is visible does something. No dead buttons. No empty states that look broken. No routes that render nothing.
- **Copy is Pane-branded:** no visible "BrowserOS" in user-facing text (code-level references like `chrome://browseros` are fine; displayed strings are not). No URLs or email addresses pointing to `browseros.com`.
- **Empty states are useful:** when a feature has no data yet (no tasks, no memories, no captures, no reach configured), the empty state tells the user what to do next, not just "nothing here."
- **Placeholders are real:** every `placeholder=` attribute on an input should reflect what the field actually expects.
- **Loading and error states are handled:** every async fetch has a loading state and a non-crashing error state.
- **Feature interactions are consistent:** approving a scheduled task from the approval UI and from a Telegram reply should both work. The action log should reflect both. Memory curation reflects actual usage.

Produce a written inventory of every issue you find before fixing anything. Fix them all. Pay particular attention to:

- The onboarding flow: every step should feel intentional and complete; the ICP selection should lead somewhere meaningful; the demo suggestions should work.
- The adaptive home: widgets should appear with real data (or degrade cleanly to the day-1 fallback with a clear "here's what will show up as you use Pane" message). The pin/hide/dismiss cycle should work and persist.
- The capture page: the recording bubble, session list, and live transcript panel should all work together. The consent toggle and per-domain settings should be visible and editable.
- The memory and skills page: staged skills should be reviewable and approvable. The curation digest stub file should be surfaced in the UI rather than silently sitting on disk.
- The reach settings: Telegram pairing, SMTP config, OS push, and quiet hours should all be usable without reading source code.
- The action log: the replay affordance should work. The trust panel should explain consequence classes in plain language.
- The triggers panel: creating and deleting a trigger should work end-to-end, including the cooldown display.

The standard: a smart user who has never seen Pane should be able to navigate the full product without confusion, dead ends, or "this doesn't work yet" moments.

---

### 2. Cross-platform packaging and auto-update

Pane must be installable and self-updating on all three platforms without a Pane-operated server.

**macOS:**
- Builds must be signed with a Developer ID and notarized. Wire this into `release-browser.yml`. The signing step should be conditional on the `APPLE_DEVELOPER_ID_CERT` and `APPLE_NOTARIZATION_CREDS` secrets being present; if absent, emit a clear warning and produce an unsigned build (for CI/OSS contributors) rather than failing.
- Auto-update via Sparkle using the signed appcast at `updates/browser/appcast.xml` on GitHub Releases. This is already partially wired — the `SPARKLE_PRIVATE_KEY` path exists; ensure the appcast update flow works end to end: publish a signed manifest → an installed Pane downloads and applies the update on next launch.
- The LaunchAgent label should be `com.pane.agent-server` (not `com.browseros.agent-server`). The plist path and all related branding should be `pane`, not `browseros`.
- The release keep-alive binary path (`TODO: finalize path` in `keep-alive.ts`) must be resolved for release builds. In a packaged `.app`, the server binary sits next to the app (or inside the bundle under `Contents/MacOS/`). Implement `resolveServerProgramArguments` for the release case.

**Windows:**
- Land the `KeepAliveService` interface implementation for Windows: Task Scheduler on-logon (`schtasks`), Windows toast via `SnoreToast` or the native WinRT notification API, Credential Manager/DPAPI for secrets. The server runs the same Bun binary bundled with the app.
- Wire Windows Authenticode signing into the release workflow. The signing step should be conditional on `WINDOWS_CODESIGN_CERT` being present; produce an unsigned installer if absent.
- Auto-update via WinSparkle or a signed manifest checked against GitHub Releases. The update server is a static file host — never a control plane.

**Linux:**
- Land the `KeepAliveService` implementation for Linux: `systemd --user` unit, `libnotify` for notifications, `libsecret` for credentials, Unix-socket CDP.
- Ship an AppImage with zsync-based delta updates. The appcast for Linux should live alongside the macOS one.
- Accept that signing on Linux is community-contributed; emit an unsigned AppImage with a clear install note.

**For all platforms:**
- The `--server-only` mode must work correctly on all three platforms before keep-alive is considered done on that platform.
- Document the install path, update mechanism, and keep-alive behavior per platform in `INSTALL.md` (create this file).

---

### 3. Local diagnostics surface

A user who is also their own operator needs to understand what Pane is doing and fix it themselves.

Add a `#/settings/diagnostics` route (wire it into the settings sidebar under a "Diagnostics" entry). This page shows:

- **Server health:** is the agent server running? What port? Last restart time. Any crash in the last 24h (read from logs).
- **Browser / CDP connection:** connected / disconnected; CDP port. Reconnect button.
- **Model connectivity:** for each configured provider, a one-tap "test connection" that returns OK or the error. Last successful call timestamp.
- **Disk usage:** `~/.browseros/` total + per-bucket breakdown (memories, captures per bucket, graph index, logs). With a button to open the folder in Finder/Explorer/Files.
- **Capture state:** ASR sidecar running/stopped; which buckets have capture consent; current retention policy per bucket; disk used by captures.
- **Reach status:** which transports are configured; quiet hours; last notification sent.
- **Keep-alive status:** installed/not installed per platform; any errors.
- **Action log summary:** count of approved/denied/replayed actions in the last 7 days.
- **Self-service:** "Export my data" (produces a tarball of `~/.browseros/` minus the SQLite WAL, plus a `README.txt` explaining the format); "Wipe context index" (clears the graph and rebuilds from durable sources — memory files survive); "Reset onboarding" (clears `local:onboardingCompleted` so the user can re-run setup).
- **Logs:** link to open `~/.browseros/logs/` in the system file manager; rotating log output visible inline (last 200 lines).

Log rotation: the server should write to `~/.browseros/logs/pane-server-YYYY-MM-DD.log`, keeping the last 7 days. Wire this into the server startup if it is not already.

---

### 4. Full CI test coverage

Every phase shipped tests. They are not all in CI. Fix this.

The `test.yml` matrix should cover:

- `server-agent` (existing: `bun run test:agent`)
- `server-api` (existing: fix the known Klavis failures — those tests are for deleted modules and should be removed, not skipped)
- `server-tools` (existing)
- `server-browser` (existing)
- `server-integration` (existing)
- `server-lib` (existing)
- `server-root` (existing)
- `server-memory` — add this: `bun run test:memory` (the memory suite from Phase 4)
- `server-capture` — add this: `bun run test:capture` (Phase 6 unit + pipeline tests)
- `server-scheduler` — add this: `bun run test:scheduler` (Phase 5 scheduler + reach tests)
- `app` — add this: `bun test` in `apps/app` (all 290+ app tests)
- `cli` — add this: `go test ./...` in `apps/cli`
- `trust-invariants` — add this as a named suite: `bun test tests/agent/trust-invariants.test.ts`

For the `server-api` suite: audit `tests/api/services/klavis/` — those tests reference deleted modules. Remove them rather than maintaining broken dead tests. The suite should pass clean.

For the browsing-quality / pane-thesis eval scenario: ensure the `browsing-quality-baseline` and `browsing-quality-with-graph` scenarios run in CI (they may already — verify) and that the absolute latency cap is documented and enforced.

Add a `bun run check` step that runs typecheck across all packages as a required gate on every PR. If this already runs (it does in `code-quality.yml`), verify it is actually blocking merges.

---

### 5. Pane-thesis eval

The eval scaffold at `apps/eval/pane-thesis/` currently has two trivial browsing scenarios. Extend it with a real multi-step task that exercises what Pane actually claims to do.

The eval scenario should cover, in a single multi-step task:

1. **Browse and read:** navigate to a real URL, extract information from the page, ingest it into the context graph.
2. **Workspace + agent:** write a file to a workspace using `filesystem_write` via the trust gate (auto-approve for eval).
3. **Context recall:** in a follow-up turn, use `context_recall` or `context_search` to retrieve what was read in step 1 without re-navigating.
4. **Memory:** add a memory entry during the task; verify it appears in `~/.browseros-dev/memories/MEMORY.md` after the run.
5. **Trust audit:** the action log should contain a record of the write from step 2.

The grader for this scenario checks: (a) the file was written with the correct content, (b) context recall returned a hit from the page visited in step 1, (c) the memory entry was written, (d) the action log entry exists.

This scenario is the public credibility artifact — "here is what Pane can do that a plain browser + Claude cannot: it remembers what you read, writes to your files with your consent, and knows what it did." Wire it into `apps/eval/pane-thesis/config.ts`.

---

### Known gaps to specifically address

These were flagged across phase reports and codebase inspection:

1. **JTBD popup:** `modules/jtbd-popup/` still exists and fires after N messages. This is a BrowserOS survey feature. Verify whether it is still rendered and triggered. If it is, disable it for Pane — the onboarding ICP step replaced it.
2. **`com.browseros.agent-server`:** Rename to `com.pane.agent-server` in the LaunchAgent plist and all related code.
3. **`BROWSEROS_APPIMAGE_URL`:** In `test.yml`, this points to `files.browseros.com/download/BrowserOS.AppImage`. Replace with the Pane AppImage URL once Linux builds exist, or remove it from test env if the tests don't actually need it.
4. **Dead routes:** `/audit`, `/observability`, `/executions` redirect to `/home`. These are leftover BrowserOS routes. Keep the redirects (for any old deep-links) but make sure no nav item points to them.
5. **"More shortcuts coming soon":** The `ShortcutsDialog` footer says this. Either add more shortcuts or remove the line. It reads as a placeholder.
6. **Klavis tests:** `tests/api/services/klavis/` — remove, don't skip.
7. **LLM Hub screen (`screens/llm-hub/`):** verify whether this is still reachable from any nav item or route. If it is orphaned, remove the screen. If it is needed, make sure it is functional.
8. **`credits` module:** `modules/credits/` exists. Verify it is fully dead-striped in the Pane fork (the `CREDITS_SUPPORT` flag should hard-false it). The UI should never show a credits badge or upsell.
9. **`modules/graphql/`:** BrowserOS used a GraphQL API for chat history (now server SQLite). Verify the graphql history branch is dead and the module is not imported outside its own folder.
10. **`acpx/runtime.ts` TODO:** `// TODO: drop this once acpx/runtime exposes a real system-prompt` — assess whether this is still needed or can be resolved.
11. **Keep-alive release path:** the `TODO: finalize path` in `keep-alive.ts` must be resolved before v1.0.

---

## Ship gate (Pane v1.0)

All of the following must be true:

1. **Every route in the app renders correctly.** No empty screens. No dead buttons. No visible "BrowserOS" in any user-facing string.
2. **Every feature that shipped in Phases 1–6 works end to end** from the UI — not just via API or test. Walk the full product manually with a real LLM provider configured.
3. **macOS signed + notarized build** passes Gatekeeper on a clean macOS machine. Auto-update works: install v1.0, publish a v1.0.1 manifest, verify Pane updates itself.
4. **Windows and Linux** builds exist and keep-alive is implemented (even if signing is community-contributed). The user can install, run, and configure Pane on all three platforms.
5. **`bun run check`** (typecheck across all packages) passes with zero errors.
6. **The full CI test matrix passes clean** — no skipped suites, no known-failing suites. The `server-api` Klavis test debt is resolved.
7. **The pane-thesis eval scenario** (multi-step browse + workspace + recall + memory + trust audit) runs and scores above its grader bar in CI.
8. **`#/settings/diagnostics`** renders real data and all self-service actions work.
9. **`INSTALL.md`** exists and accurately describes macOS, Windows, and Linux install + update + keep-alive setup.
10. **No TODOs or FIXMEs in user-facing code paths** that affect real behavior (code-comment explanations of trade-offs are fine; deferred feature notes in internal utilities are fine if they don't affect what the user sees).

When all ten criteria are met, write `specs/PHASE-7-REPORT.md` and stop.

---

## What not to do

- Do not add new features. This phase is exclusively about quality and correctness of what exists.
- Do not start Phase 8 (evolving home / custom widgets) or Phase 9 (page reshape).
- Do not add Pane-operated servers, cloud sync, hosted credits, or any State B feature.
- Do not rebuild things that already work well. Surgical fixes only.
- Do not push unless asked.
