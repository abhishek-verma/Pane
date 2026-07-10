# Phase 5 Execution Prompt — Proactive & Reach: Pane works for you, even away

> Paste this into a fresh agent session. This prompt is **deliberately verbose and prescriptive** because it will be executed by a smaller model. Every module names exact files, exact functions, exact edits, exact test commands, and exact pass signals. Follow it literally. When something in the codebase contradicts this prompt, **stop and report** — do not improvise.

---

## Prompt

You are implementing **Phase 5 of the Pane OSS build** — "Proactive & Reach." Pane is a pure-OSS, no-Pane-server, local-first agentic browser (a fork of BrowserOS).

**Phase 1** — Bedrock.
**Phase 2** — Trust & Workspaces. See `specs/PHASE-2-REPORT.md`.
**Phase 3** — Context Graph & Tasks. See `specs/PHASE-3-REPORT.md`.
**Phase 4** — Memory & Skills. See `specs/PHASE-4-REPORT.md` — **this is the source of truth for what exists. Do not re-implement Phase 4.**

**Phase 5's job:** make Pane work *for* you on a schedule and on graph events; emit a **daily digest**; keep the agent server alive at login on macOS (opt-in); reach you out-of-browser (OS push, your SMTP/IMAP, Telegram) including **approve/deny over channel**; make scheduled runs **idempotent**; and ship the **adaptive home** (evolving new-tab widgets) as the visible surface for digest + day widgets.

### Ship gate (Pane v0.5) — the definition of "Phase 5 done"

All of these must be true and demonstrated:

1. **Trigger engine:** rules can subscribe to graph events (not only wall-clock) and start a run with the right prompt. At least one rule shape ships: "on Nth occurrence of matching event kind/tool, run Y" (or equivalent documented rule DSL).
2. **Daily digest:** a first-class scheduled job assembles recent graph activity + memory + pending tasks into a digest file under `~/.browseros/memories/digests/` (e.g. `daily-YYYY-MM-DD.md`), delivers via reach when configured, and is readable by the adaptive home **without an LLM call at tab-open**.
3. **macOS keep-alive (opt-in):** a `launchd` LaunchAgent (or documented installer path) can start the **server** at login without the full UI. Honest in-product copy: browser-tool jobs need a browser; closed laptop / powered-off machine does not run. Non-browser work can fire while the machine is awake with keep-alive on.
4. **Reach transports:** `@browseros/reach` (or `apps/server/src/reach/`) behind a `ReachTransport` interface with three State A impls: **OS push**, **SMTP/IMAP** (user credentials in secure store), **Telegram bot** (poll Telegram's API — not a Pane server). Configure + send test message works.
5. **Approval-over-channel:** an unattended gated action (`write-external` / `system` / `spend` without pin) **pauses**, sends a reach message with approve/deny, never auto-approves; approve resumes, deny cancels; timeout skips + logs.
6. **Idempotency:** a crashed mid-run does not re-execute completed consequential steps; `write-external`/`spend` dedupe by idempotency key.
7. **Adaptive home:** new-tab widget host (extend existing `screens/newtab/` — **no new entrypoint**) shows digest + available day widgets ranked with hysteresis; pin/hide/dismiss writes preference to `USER.md`; day-1 fallback (recent sites + composer) when graph/persona empty; home open **<150 ms**, no LLM at render.
8. `bun run check` + relevant tests green. Write `specs/PHASE-5-REPORT.md` and **stop** — do not start Phase 6.

### Repo facts (memorize before coding)

- **Monorepo root:** `packages/browseros-agent/`. Bun for TS; Go CLI in `apps/cli/`.
- **Phase 4 landmarks (reuse — do not rebuild):**
  - Memories SoT: `~/.browseros/memories/` (`SOUL.md`, `USER.md`, `MEMORY.md`, `skills/`, `staging/`, `digests/`, `persona-map.json`) via `apps/server/src/memory/`.
  - Curation already writes stub digests under `digests/curation-YYYY-MM.md` — **daily digest is a sibling**, not a replacement.
  - Prompt budget + `soulContent` already wired in `AiSdkAgent.create` / `prompt.ts`.
  - Review job: `startMemoryReviewMonitor` (6h server interval) — pattern to copy for digest/trigger monitors.
  - Migration through **`0008_bored_karen_page`**. Next is **`0009_*`**. Mirror `currentMigrationHistory` + `currentSchemaStatements` in `apps/server/src/lib/db/client.ts`.
- **Scheduled tasks today (app-owned):**
  - Storage: `apps/app/lib/schedules/scheduleStorage.ts` (`local:scheduledJobs`, `local:scheduledJobRuns`).
  - Alarms: `apps/app/entrypoints/background/scheduledJobRuns.ts` + `chrome.alarms`.
  - Types: `apps/app/lib/schedules/scheduleTypes.ts` (`ScheduledJob`, `ScheduledJobRun` with optional `toolCalls`).
  - UI: `apps/app/screens/scheduled-tasks/`.
  - **Do not throw this away.** Phase 5 adds a **server-side** scheduler/trigger/digest path for keep-alive + graph triggers, and extends runs for idempotency. Prefer: server owns trigger rules + digest + keep-alive execution; app chrome.alarms remains the in-browser time scheduler and can call into the same run executor. Document the split in the report.
- **There is no `apps/server/src/scheduler/` yet** — create it.
- **Graph events:** `@browseros/context-graph` `GraphEvent` (`graph_events` table) written by ingest (`apps/server/src/context/ingest.ts`). Subscribe **after** successful ingest writes — do not re-ingest.
- **Trust gate:** `apps/server/src/agent/trust/gate.ts` — consequential classes pause via AI SDK `needsApproval`. Approval resume already works for interactive chat (`toolApprovalResponses` + `/trust/replay`). Phase 5 extends the **unattended** path to reach.
- **Battery:** `apps/server/src/context/battery.ts` — pause non-critical proactive work on battery (same pattern as ingest/review).
- **New tab surfaces to extend (not replace):**
  - `apps/app/screens/newtab/index/NewTabBranding.tsx`, `NewTabChat.tsx`, `RecentSites.tsx`, `ScheduleResults.tsx`
  - Layout: `screens/newtab/layout/NewTabLayout.tsx`
  - Composer sibling: `screens/agent-command/AgentCommandHome.tsx`
  - Spec: `specs/15-adaptive-home.md`
- **OAuth / secrets pattern:** `apps/server/src/lib/clients/oauth/` + `oauth_tokens` table — mirror for SMTP/Telegram secrets (never plaintext in prefs JSON). Prefer OS keychain if already used; else encrypted SQLite like OAuth tokens. Document choice.
- **No Pane-operated servers.** Telegram hits Telegram; SMTP hits the user's mail host; OS push is local. No `api.pane.com` for reach.
- **Commands:** `bun run check`; `cd apps/server && bun run test:agent` / `test:api` / `test:lib` / `bun run db:generate`; `cd apps/app && bun run test`; `cd apps/cli && gofmt -l . && go vet ./... && go test ./...`.

### Preconditions — verify Phase 4 before starting

1. `specs/PHASE-4-REPORT.md` says ship gate met.
2. These exist and compile:
   - `apps/server/src/memory/` (files, tools, review-job, prompt-budget, personas)
   - `context_recall` is real (no Phase-3 stub)
   - `#/settings/memory`, CLI `memory` / `skills`
   - migrations through `0008_*` mirrored in `client.ts`
   - Trust gate + ApprovalCard + action log
   - Context graph ingest + `graph_events`
3. `bun run check` green on HEAD.
4. Spot-check: Memory page, scheduled tasks list, new tab still load.

If any precondition fails, **stop and report**.

### Required reading

- `specs/PHASE-4-REPORT.md` — memories paths, tools, review schedule, trust hardening, deviations.
- `specs/PHASE-2-REPORT.md` — gate, approval resume, consequence classes.
- `specs/PHASE-3-REPORT.md` — graph ingest, tasks tools.
- `specs/07-proactive-and-scheduled-work.md` — triggers, keep-alive honesty, unattended approval.
- `specs/08-reach-and-channels.md` — OS push + email + Telegram thin edge; inbound minimal.
- `specs/15-adaptive-home.md` — widget model, ranking, perf budget, day-1 fallback.
- `specs/IMPLEMENTATION-PLAN.md` Phase 5 (M5.1–M5.7).
- `specs/ARCHITECTURE-DESIGN.md` (scheduler / keep-alive / reach sections if present).
- Code: `scheduledJobRuns.ts`, `scheduleTypes.ts`, `gate.ts`, `memory/review-job.ts`, `context/ingest.ts`, `context-graph` `GraphEvent`, newtab screens.

### Cross-cutting rules

- **No Phase 6/7.** No meeting ASR, tab-audio capture, browsing learnings pipeline, page reshape / feed de-slop. Adaptive home widgets that need capture (next meeting from capture, research thread) **must degrade honestly** — omit or show "enable capture later," never fake data.
- **No cloud-headless runner.** State B only. Do not stub a Pane cloud scheduler.
- **Never auto-approve** consequential actions over channel or keep-alive. Pins still work; channel approve is explicit user action.
- **Quiet hours + rate limits** on reach outbound (defaults: e.g. max N messages/day, quiet 22:00–08:00 local — configurable; document defaults).
- **Trusted sender allowlist** for Telegram/email inbound (pairing code). Reject unknown senders.
- **Idempotency before retries.** No "just re-run the whole prompt" after crash for jobs that already did `write-external`/`spend`.
- **Files for digests:** daily digest markdown under `memories/digests/` is SoT for home cache; optional SQLite index of run metadata is fine.
- **Pause on battery** for digest generation / trigger fan-out when non-critical (reuse `battery.ts`).
- **One tool/API surface** where new agent tools appear: classify in `consequence-class.ts`; register loop + MCP.
- **Small green commits.** Do not push unless asked.
- **Do not rename `@browseros/*` or touch `claw-*`.** Do not re-enable Pane-operated cloud APIs.

### Key code landmarks

| What | File | Symbol / note |
|------|------|----------------|
| App scheduled runs | `apps/app/entrypoints/background/scheduledJobRuns.ts` | `chrome.alarms.onAlarm` |
| Job/run types | `apps/app/lib/schedules/scheduleTypes.ts` | extend for idempotency fields |
| Schedule storage | `apps/app/lib/schedules/scheduleStorage.ts` | chrome.storage |
| Trust gate pause | `apps/server/src/agent/trust/gate.ts` | `needsApproval` |
| Approval resume | `apps/server/src/api/services/chat-service.ts` | `toolApprovalResponses` |
| Action log | `apps/server/src/lib/db/schema/action-log.ts` | audit |
| Graph events | `packages/context-graph/src/types.ts` | `GraphEvent` |
| Ingest write path | `apps/server/src/context/ingest.ts` | hook after insert |
| Memory review interval | `apps/server/src/memory/review-job.ts` | copy pattern |
| Digests dir | `apps/server/src/memory/skills.ts` / files | `DIGESTS_DIR`, curation stub |
| Prompt / soul | `apps/server/src/agent/prompt.ts` | already wired |
| Battery | `apps/server/src/context/battery.ts` | pause helpers |
| DB bootstrap | `apps/server/src/lib/db/client.ts` | next `0009_*` |
| New tab | `apps/app/screens/newtab/` | widget host here |
| OAuth secrets pattern | `apps/server/src/lib/clients/oauth/` | mirror for reach creds |
| CLI pattern | `apps/cli/cmd/memory.go` | copy for `reach` / `digest` if needed |

---

## Execution order

### M5.1 — Trigger engine `[seq]`

**What:** Server-side trigger engine that subscribes to graph events and fires runs.

**How:**

1. Create `apps/server/src/scheduler/` with:
   - `types.ts` — `TriggerRule` (`id`, `name`, `enabled`, `match` { toolName? / event payload predicate / occurrenceN }, `prompt` or `jobId`, `bucketId`, `createdAt`).
   - `rules-store.ts` — persist rules in SQLite (migration `0009_*`: `trigger_rules` table) **or** JSON under `~/.browseros/scheduler/rules.json` if you must ship faster — prefer SQLite + mirror in `client.ts`.
   - `engine.ts` — `onGraphEvent(event: GraphEvent)` evaluates enabled rules; on match, enqueue/start a run via a shared **run executor** (extract or wrap the path that scheduled jobs already use to call chat/agent).
   - Wire: after ingest successfully inserts a `graph_events` row, call `onGraphEvent` (best-effort, never fail the tool).
2. Reuse scheduled-task execution semantics (same agent loop, same trust gate). Do **not** invent a second agent runtime.
3. UI minimum: extend Scheduled Tasks page **or** Settings with "Triggers" list (create/edit/enable). CLI optional: `browseros-cli triggers list|add|enable`.
4. Rate-limit: same rule cannot fire more than once per cooldown (default 5 min) unless occurrence-N requires it.

**Test:**

- Unit: synthetic `GraphEvent` matching rule → executor called with expected prompt; non-match → no call; cooldown suppresses duplicate.
- Integration: insert event via ingest helper → run record created.

**Commit:** `feat(server): graph-event trigger engine (M5.1)`

---

### M5.2 — Daily digest `[seq → M5.1 or par with shared scheduler]`

**What:** Habit-loop driver: assemble digest from graph + memory + tasks; cache for home; deliver via reach when configured.

**How:**

1. `apps/server/src/scheduler/digest.ts`:
   - Query recent `graph_events` / nodes (bounded), pending `tasks`, and a short `context_recall` / memory snapshot.
   - Write `memories/digests/daily-YYYY-MM-DD.md` (canonical). Also write/update `memories/digests/latest-daily.md` symlink or copy for home.
   - Use a **cheap/deterministic assembler first** (template + bullets). Optional LLM polish behind a flag / when a model is configured — never block home on LLM; if polish fails, keep template digest.
2. Schedule: server interval or cron-like "local hour H" (default 8:00 from `USER.md` timezone if present, else system). Start from `Application` like `startMemoryReviewMonitor`. Manual: `POST /scheduler/digest/run`.
3. After write, call `reach.notify({ type: 'digest', path })` if any transport enabled (M5.4) — if reach not ready yet, no-op + log.
4. Pause on battery / quiet hours.

**Test:**

- Integration: seed graph + task + memory → `runDailyDigest()` → file exists with real content; second run same day overwrites or no-ops (document).
- Assert home can read file without calling LLM.

**Commit:** `feat(server): daily digest job (M5.2)`

---

### M5.3 — macOS keep-alive `[par]`

**What:** Opt-in login item that keeps the **agent server** up without full browser UI.

**How:**

1. Define `KeepAliveService` interface in `apps/server/src/scheduler/keep-alive.ts` (or `packages/shared`): `install()`, `uninstall()`, `status()`.
2. macOS impl: write a LaunchAgent plist under `~/Library/LaunchAgents/` that starts the packaged/dev server binary with a **headless/server-only** flag (reuse existing server entrypoint — do not launch the full Chromium UI). Document the exact binary path resolution for Pane Dev vs release.
3. Settings UI toggle: "Keep Pane agent running at login" with honest copy from `specs/07-proactive-and-scheduled-work.md` (closed laptop / no browser-tools without browser).
4. When a keep-alive job needs browser tools and no browser is available: mark run `failed`/`skipped` with clear reason — do not hang.
5. Windows/Linux: interface + "not implemented" status is OK for v0.5 if macOS works; note in report. Do not fake install success.

**Test:**

- Unit: plist contents contain expected ProgramArguments / KeepAlive keys.
- Integration/manual checklist in report: install → logout/login or `launchctl load` → server port up without UI; uninstall cleans plist.

**Commit:** `feat(server): macOS keep-alive LaunchAgent (M5.3)`

---

### M5.4 — Reach transports `[seq → M2.2 trust already done]`

**What:** Peer-to-peer reach: OS push, SMTP/IMAP, Telegram.

**How:**

1. Package `@browseros/reach` under `packages/reach/` **or** module `apps/server/src/reach/` if packaging is heavy — prefer a small package with pure interfaces + server adapters.
2. Interface:

```ts
interface ReachTransport {
  id: 'os-push' | 'email' | 'telegram'
  isConfigured(): Promise<boolean>
  send(msg: ReachMessage): Promise<void>
  // optional inbound
  startInbound?(handler: (cmd: ReachInbound) => Promise<void>): Promise<void>
}
```

3. Impls:
   - **OS push:** from the **app** use `chrome.notifications` (add permission if needed); from **server-only** keep-alive path use a Node notifier or queue a notification for next app attach. Document which path is primary. Never require a Pane cloud push service.
   - **Email:** SMTP send + optional IMAP poll for replies. Credentials in secure store (mirror OAuth token store). Settings form: host, port, user, password/app-password, from address.
   - **Telegram:** bot token + allowlisted chat id(s); long-poll `getUpdates`; send with inline approve/deny where possible. Pairing: one-time code shown in Settings.
4. Settings: `#/settings/reach` — enable transports, test send, quiet hours, rate limit.
5. Outbound message types used in Phase 5: `digest`, `approval`, `trigger`, `nudge` (nudge can be stub rate-limited).
6. CLI optional: `browseros-cli reach test`.

**Test:**

- Unit: each transport send with mocked HTTP/SMTP/notifications.
- Integration: telegram/email with mocks; pairing rejects unknown chat id.
- Manual checklist: configure one transport, receive test message.

**Commit:** `feat: reach transports OS push + email + Telegram (M5.4)`

---

### M5.5 — Approval-over-channel `[seq → M5.4]`

**What:** Unattended gated actions pause and ask over reach; never auto-approve.

**How:**

1. Detect **unattended** runs: scheduled / trigger / keep-alive executor sets `GateContext.unattended = true` (or `surface: 'unattended'`).
2. When `needsApproval` would pause and no interactive UI is attached:
   - Persist a pending approval record (SQLite `pending_approvals` in `0009_*` or reuse action_log row with status `approval-requested` + deep-link token).
   - `reach.send({ type: 'approval', runId, toolName, preview, approveToken, denyToken })`.
   - Run stays paused until approve/deny/timeout (default 30–60 min — document).
3. Inbound: Telegram `/approve <id>` or button; email reply `APPROVE <token>`; OS notification click opens Pane deep link `#/approvals/...` or sidepanel.
4. Approve path must reuse existing promote/resume machinery (`toolApprovalResponses` / replay) — **do not bypass the gate**.
5. Deny → cancel run, log. Timeout → skip, log. Never treat silence as approve.

**Test:**

- E2E/unit: unattended `write-external` → reach send called → pause → approve handler → execute once + action log; deny → no execute.
- Property: channel message cannot set `__promoted` without going through the approval record.

**Commit:** `feat(server): approval-over-channel for unattended runs (M5.5)`

---

### M5.6 — Scheduled-task idempotency `[par]`

**What:** Crash mid-run does not duplicate consequential side effects.

**How:**

1. Extend run model with:
   - `idempotencyKey` (stable per scheduled fire: `jobId + scheduledSlot` or `jobId + runId`).
   - `completedSteps: Array<{ toolCallId, toolName, class, fingerprint }>` persisted as the run progresses (server SQLite preferred for keep-alive; sync/mirror into `scheduledJobRunStorage` for app UI if needed).
2. On retry/resume: skip steps whose fingerprint already completed; for `write-external`/`spend`, refuse re-exec of same fingerprint.
3. Update `scheduledJobRuns.ts` stale-timeout path: mark failed but **keep** completedSteps for resume.
4. Document: read-only steps may re-run; consequential steps must not.

**Test:**

- Integration: simulate crash after one consequential tool → retry → that tool not re-executed; remaining steps run.
- Unit: fingerprint equality.

**Commit:** `feat: scheduled run idempotency + step checklist (M5.6)`

---

### M5.7 — Adaptive home `[seq → M4.7, M5.2]`

**What:** New tab becomes the visible surface for soul + digest + day widgets.

**How:**

1. Add `apps/app/screens/newtab/home/` (or `widgets/`):
   - `HomeEngine.ts` — pure ranking: inputs = digest availability, pending approvals (action log / tasks), resumed work (graph current_work), one-click recurring (active skills with cadence if available), recent sites fallback.
   - Hysteresis: don't reorder every render; pin/hide/dismiss prefs.
   - Dismiss → append preference line to `USER.md` via existing memory file API (`PUT /memory/files/...` or dedicated `POST /memory/home-prefs`).
2. Widgets to ship in v0.5 (honest set):
   | Widget | Required |
   |--------|----------|
   | Daily digest | yes (from M5.2 file) |
   | Pending approvals / waiting | yes (action log / tasks) |
   | Resumed work | yes if graph has current work; else hide |
   | One-click recurring | yes if staged/active skill with detectable cadence; else hide |
   | Recent sites + composer | day-1 fallback always |
   | Next meeting / research / reshape | **omit or disabled stub** — Phase 6/7 |
3. Render inside existing new-tab layout **above or beside** `NewTabChat` / branding — one composition, not a dashboard of cards-for-cards'-sake. Follow existing visual language.
4. Each widget: one-line "why this is here" on first show; pin/hide.
5. **Perf:** load cached digest + SQLite/REST queries only; **zero LLM** on tab open. Target <150 ms to first paint of widget shell (measure in test with fake timers / assert no `generateText` calls).
6. Bucket/persona: if active bucket changes, re-rank on next open (not mid-animation thrash).

**Test:**

- Unit: ranking + hysteresis + dismiss writes pref.
- Integration: with digest file present → digest widget shows content from file; empty graph → day-1 fallback.
- Perf assertion: home data loader does not call chat/LLM endpoints.

**Commit:** `feat(app): adaptive home widgets on new tab (M5.7)`

---

## Independent verification (required)

Paste into `PHASE-5-REPORT.md` before claiming ship gate:

1. **Trigger:** matching graph event starts a run; non-match does not; cooldown works.
2. **Digest:** `daily-*.md` written with graph/memory/task content; home reads file; no LLM at tab-open.
3. **Keep-alive:** macOS plist install/uninstall; honest limitation copy in UI; browser-missing jobs skip cleanly.
4. **Reach:** three transports behind one interface; test send; secrets not in plaintext prefs; unknown Telegram sender rejected.
5. **Approval-over-channel:** unattended consequential pause → reach → approve executes once / deny cancels / timeout skips; never auto-approve.
6. **Idempotency:** mid-run crash → retry skips completed consequential steps.
7. **Adaptive home:** digest + fallback widgets; dismiss → `USER.md`; capture/reshape widgets absent or clearly disabled.
8. **Trust invariants** still green; no `__promoted` on loop schema.
9. **`0009_*` mirrored** in `client.ts` (if migration added).
10. **No Phase 6/7 leakage** (no ASR, no page reshape engine).
11. **No Pane cloud push / cloud-headless.**

Recommended review of: unattended approval token handling, reach credential storage, trigger cooldown, idempotency fingerprints, home perf.

---

## Stop condition — do not auto-proceed to Phase 6

1. Full check + tests green.
2. Manual: trigger fire; digest on home; one reach test message; approve-over-channel happy path; keep-alive install (macOS).
3. Write `specs/PHASE-5-REPORT.md`.
4. **Stop.** Do not start Phase 6 (passive capture).

## What NOT to do

- No meeting capture / tab audio / browsing learnings (Phase 6).
- No page reshape / feed de-slop (Phase 7).
- No cloud-headless / Pane-operated push relay.
- No auto-approve from channel silence or "trusted owner" shortcuts that skip the gate.
- No second full agent runtime beside the existing loop.
- No new browser entrypoint for home — extend `screens/newtab/`.
- Do not delete app `chrome.alarms` scheduled tasks without a migration path.
- Do not push unless asked.

## If you hit a blocker

Append `BLOCKERS` to `specs/PHASE-5-REPORT.md` with file:line and smallest next step. Likely:

- (a) Keep-alive binary path differs Dev vs release → document both; ship Dev path + release TODO.
- (b) No model for digest polish → template-only digest is ship-gate complete.
- (c) IMAP inbound hard → outbound SMTP + Telegram inbound enough; note partial email inbound.
- (d) Unifying app chrome.alarms runs with server idempotency store is messy → server SQLite is SoT for keep-alive/trigger runs; app storage remains for UI list with best-effort sync; document.
- (e) `chrome.notifications` unavailable in some contexts → server notifier fallback + report.
