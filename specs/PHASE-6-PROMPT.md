# Phase 6 Execution Prompt — Passive Capture & Buckets: the flagship intrinsic

> Paste this into a fresh agent session. This prompt is **deliberately verbose and prescriptive** because it will be executed by a smaller model. Every module names exact files, exact functions, exact edits, exact test commands, and exact pass signals. Follow it literally. When something in the codebase contradicts this prompt, **stop and report** — do not improvise.

---

## Prompt

You are implementing **Phase 6 of the Pane OSS build** — "Passive Capture & Buckets." Pane is a pure-OSS, no-Pane-server, local-first agentic browser (a fork of BrowserOS).

**Phase 1** — Bedrock (incl. M1.9 ASR benchmark decision).
**Phase 2** — Trust & Workspaces. See `specs/PHASE-2-REPORT.md`.
**Phase 3** — Context Graph & Tasks (buckets, `domain_grants`, ingest). See `specs/PHASE-3-REPORT.md`.
**Phase 4** — Memory & Skills. See `specs/PHASE-4-REPORT.md`.
**Phase 5** — Proactive & Reach (digest, triggers, keep-alive, reach, adaptive home). See `specs/PHASE-5-REPORT.md` — **source of truth for what exists. Do not re-implement Phase 5.**

**Phase 6's job:** native meeting capture (tab audio + page content → streaming transcript), opt-in browsing learnings + research threading into buckets, always-visible consent glow, bucket-scoped storage, and Capture UI — the flagship "we are the browser" capability.

### Ship gate (Pane v0.6) — the definition of "Phase 6 done"

All of these must be true and demonstrated:

1. **Native capture primitive:** Chromium-fork API captures tab audio + page content for a given tab; MV3 `tabCapture` is not the primary path. Stream reaches the server for transcription.
2. **Meeting pipeline:** start/stop capture on a meeting tab → streaming partial transcript + final transcript stored under `~/.browseros/capture/<bucket>/`; searchable via `context_search`; notes/summary optional (template OK; LLM polish optional).
3. **Transcription:** `TranscriptionProvider` with **local `faster-whisper` sidecar default** per `specs/ASR-BENCHMARK.md` (M1.9 go) + **BYOK opt-in** (OpenAI/Deepgram). Web Speech API and Pane-operated Whisper are **not** allowed as defaults.
4. **Browsing learnings:** opt-in per-domain; facts/workflows feed the **staged** memory/skill loop (never silent promote); research bucket records page chains + verbatim quotes; citations in `context_search`.
5. **Consent:** capture **OFF by default**; separate consent classes (meetings vs browsing vs research); glow visible while capturing; bucket assignment shown and reassignable — never silent.
6. **Untrusted input:** captured text in tool results cannot rewrite system prompt or auto-approve; extend `trust-invariants.test.ts`.
7. **Capture UI:** `#/capture` — meetings list, transcript view, bucket manager, pause states (battery/disk/load).
8. **Adaptive home:** enable `next-meeting` and `research-thread` widgets (Phase 5 left them out); degrade cleanly when capture off.
9. **Performance:** pause capture on battery / disk-low; prune raw audio per retention; cadenced browsing extraction (not every navigation).
10. `bun run check` + relevant tests green. Write `specs/PHASE-6-REPORT.md` and **stop** — do not start Phase 7.

### Repo facts (memorize before coding)

- **Monorepo root:** `packages/browseros-agent/`. Chromium fork patches: `packages/browseros/chromium_patches/`.
- **M1.9 decision (locked):** `specs/ASR-BENCHMARK.md` — **Go** local default via `faster-whisper` sidecar (`small.en` on Apple Silicon); BYOK fast path; diarization deferred (use page participant labels first). Harness: `apps/eval/scripts/asr-benchmark/`.
- **Phase 5 landmarks (reuse):**
  - Scheduler: `apps/server/src/scheduler/` (digest, triggers, home).
  - Adaptive home: `apps/server/src/scheduler/home.ts` + `apps/app/screens/newtab/home/` — extend widget types; do not rebuild home from scratch.
  - Battery: `apps/server/src/context/battery.ts`.
  - Reach: `apps/server/src/reach/` — digest can mention today's meetings; no new Pane server.
  - Migration through **`0009_curvy_bucky`**. Next is **`0010_*`**. Mirror `currentMigrationHistory` + `currentSchemaStatements` in `apps/server/src/lib/db/client.ts`.
- **Buckets already exist (Phase 3):** `buckets` table, `GET/POST /context/buckets`, `domain_grants` in `apps/server/src/context/grants.ts`. **Extend** for capture consent — do not invent a parallel bucket system.
- **Graph ingest:** `apps/server/src/context/ingest.ts` + `onGraphEvent` for triggers. Capture should add graph nodes/edges for meetings and research threads.
- **Memory loop:** `apps/server/src/memory/review-job.ts` stages inferred skills; browsing learnings must **stage** via same path (`writeStagedSkill` / `memory_add` with `source:'inferred'`).
- **Injection scan:** `@browseros/memory/scan` `assertMemoryContent` — run on any capture-derived memory/skill write.
- **Glow today:** `apps/app/entrypoints/glow.content/index.ts` — used for **agent-active-tab** glow during chat (`GlowMessage` via `notify-active-tab.hooks.tsx`). **Repurpose/extend** for capture consent light — distinguish `mode: 'agent' | 'capture'` so capture glow is always visible while recording and shows stop.
- **No `captureTabAudio` in `browser_os.idl` yet** — you must add fork primitive (M6.1). Existing IDL: `packages/browseros/chromium_patches/chrome/common/extensions/api/browser_os.idl`.
- **Page content:** reuse `browser-mcp` `snapshot` / `observe` extractors (`packages/browser-mcp/src/tools/snapshot.ts`) for meeting page content and browsing learnings — do not duplicate CDP logic.
- **Storage root:** `getBrowserosDir()` + new `PATHS.CAPTURE_DIR_NAME` (e.g. `capture/`) — `~/.browseros/capture/<bucketId>/meetings/<id>/` (audio chunks, transcript.json, page-snapshots/).
- **Trust:** classify any new capture tools in `packages/shared/src/trust/consequence-class.ts`. Capture start/stop = `write-local`; reading transcripts = `read`.
- **Commands:** `bun run check`; `cd apps/server && bun run test:agent` / `bun test tests/capture/`; `cd apps/app && bun run test`; `cd apps/cli && go test ./...`.

### Preconditions — verify Phase 5 before starting

1. `specs/PHASE-5-REPORT.md` says ship gate met.
2. These exist and compile:
   - `apps/server/src/scheduler/home.ts` (adaptive home data)
   - `apps/server/src/memory/review-job.ts`
   - `apps/server/src/context/grants.ts` + graph ingest
   - `apps/app/entrypoints/glow.content/`
   - migrations through `0009_*` mirrored in `client.ts`
3. `bun run check` green on HEAD.
4. Read `specs/ASR-BENCHMARK.md` and confirm M1.9 path before choosing default ASR.

If any precondition fails, **stop and report**.

### Required reading

- `specs/PHASE-5-REPORT.md` — scheduler split, home widgets, deviations.
- `specs/PHASE-4-REPORT.md` — memory staging, injection scan, files SoT.
- `specs/PHASE-3-REPORT.md` — buckets, domain grants, ingest hooks.
- `specs/14-passive-capture-and-context-buckets.md` — meetings, browsing learnings, research bucket, consent.
- `specs/ASR-BENCHMARK.md` — M1.9 decision + sidecar recommendation.
- `specs/IMPLEMENTATION-PLAN.md` Phase 6 (M6.1–M6.6).
- `specs/15-adaptive-home.md` — next-meeting + research-thread widgets.
- `specs/10-trust-privacy-security.md` — untrusted capture content.
- Code: `glow.content/index.ts`, `context/grants.ts`, `memory/review-job.ts`, `scheduler/home.ts`, `browser_os.idl`, `trust-invariants.test.ts`.

### Cross-cutting rules

- **Capture OFF by default.** No silent domain capture. Each class (meetings / browsing / research) opts in separately.
- **Glow = consent signal.** While capture is active, glow is on; stop button ends capture. Never hidden recording.
- **Captured content is untrusted data.** It may appear in tool results or staged memory only after scan; never in system prompt or instructions channel.
- **Staging for inferred learnings.** Browsing/research extractions → staged memory/skills; never auto-activate.
- **Bucket visibility.** Inferred bucket (e.g. `github.com` → work) is shown in UI; user can reassign before data is written.
- **No Pane servers.** BYOK hits provider APIs only. No `llm.browseros.com` Whisper.
- **No Phase 7+.** No packaging work, page reshape, feed de-slop, or overlay content scripts beyond capture glow.
- **Sidecar ASR.** Do not embed 0.6–1.5 GB whisper model inside Bun server process — spawn/manage sidecar (`apps/server/src/capture/asr-sidecar.ts` or similar).
- **Pause on battery** for capture + browsing extraction (reuse `battery.ts`).
- **Retention:** raw audio short (default 7 days); transcripts longer (default 90 days); configurable per bucket.
- **One tool spec** for any new agent tools (loop + MCP). Underscore names e.g. `capture_start`, `capture_stop`, `capture_status`.
- **Small green commits.** Do not push unless asked.
- **Do not rename `@browseros/*` or touch `claw-*`.**

### Key code landmarks

| What | File | Symbol / note |
|------|------|----------------|
| Glow overlay | `apps/app/entrypoints/glow.content/index.ts` | extend for capture mode |
| Agent glow hook | `apps/app/modules/chat/notify-active-tab.hooks.tsx` | separate from capture |
| Browser OS IDL | `packages/browseros/chromium_patches/.../browser_os.idl` | add capture APIs |
| Domain grants | `apps/server/src/context/grants.ts` | extend or parallel `capture_consents` |
| Graph ingest | `apps/server/src/context/ingest.ts` | add meeting/research nodes |
| Review / staging | `apps/server/src/memory/review-job.ts` | feed browsing workflows |
| Injection scan | `packages/memory/src/scan.ts` | `assertMemoryContent` |
| Home engine | `apps/server/src/scheduler/home.ts` | add widget types |
| Home UI types | `apps/app/screens/newtab/home/HomeEngine.ts` | extend `HomeWidgetType` |
| Trust invariants | `apps/server/tests/agent/trust-invariants.test.ts` | extend for capture |
| DB bootstrap | `apps/server/src/lib/db/client.ts` | next `0010_*` |
| BrowserOS dir | `apps/server/src/lib/browseros-dir.ts` | add `getCaptureDir()` |
| Snapshot tool | `packages/browser-mcp/src/tools/snapshot.ts` | page content |
| ASR harness | `apps/eval/scripts/asr-benchmark/` | reference only |
| Buckets API | `apps/server/src/api/routes/context.ts` | `/context/buckets` |

---

## Execution order

### M6.1 — Native tab-audio + capture primitive `[seq]`

**What:** Fork primitive for tab audio + page content stream; glow as capture light.

**How:**

1. **Chromium patch:** Extend `browser_os.idl` with e.g.:
   - `captureTabAudio(tabId, options)` → stream id / pipe handle
   - `stopCaptureTabAudio(tabId)`
   - `getCaptureStatus(tabId)` → `{ active, class: 'meeting'|'browsing'|'research' }`
   Implement in `chrome/browser/extensions/api/browser_os/` (follow existing browserOS API patterns in patches). **MV3 `chrome.tabCapture` is fallback only** — document if used on non-fork builds; Pane Dev fork is primary target.
2. **App bridge:** `apps/app/lib/capture/` — request capture from content/background, forward audio chunks to server via existing messaging (`RuntimeMessageType` or new WebSocket to server). Page snapshots via CDP/session already used by browser-mcp — reuse server CDP for periodic DOM snapshot during meeting capture.
3. **Glow:** Extend `GlowMessage` with `mode: 'capture' | 'agent'` and `captureClass`. Capture mode: persistent citron pulse + stop button (existing `GLOW_STOP_BTN_ID`); stopping sends `capture_stop`. Agent glow unchanged.
4. **Server ingest endpoint:** `POST /capture/chunk` (audio) + `POST /capture/page-snapshot` (text/metadata) — authenticated local-only (same origin / extension id check as other routes).
5. Meeting URL heuristics (prompt once per domain): `meet.google.com`, `*.zoom.us`, `teams.microsoft.com`, `teams.live.com`.

**Test:**

- Unit: URL matcher; glow mode routing; mock chunk handler.
- Fork/manual: start capture on tab → glow on → chunks received server-side → stop → glow off.

**Commit:** `feat(fork): tab audio capture primitive + glow consent (M6.1)`

---

### M6.2 — Meeting capture pipeline `[seq → M6.1]`

**What:** Streaming transcript + storage + graph indexing.

**How:**

1. Create `packages/capture/` (`@browseros/capture`) with:
   - `TranscriptionProvider` interface: `startSession()`, `feedChunk(audio)`, `onPartial(cb)`, `onFinal(cb)`, `stop()`.
   - `LocalFasterWhisperProvider` — spawns Python sidecar (reuse harness config: 4s chunks, VAD, `small.en` default). Sidecar script can live under `apps/server/src/capture/asr-sidecar/` or `packages/capture/asr/`.
   - `ByokTranscriptionProvider` — OpenAI / Deepgram from user API key in secure store (mirror `reach_secrets` / `oauth_tokens` pattern).
2. `apps/server/src/capture/meeting-pipeline.ts`:
   - Session lifecycle: `startMeetingCapture({ tabId, bucketId, url })` → dirs under `getCaptureDir()/bucketId/meetings/<sessionId>/`.
   - Pipe audio chunks → provider → append `transcript.jsonl` (partial + final segments with timestamps).
   - Periodic page snapshot → `page-snapshots/` + participant list from a11y tree when available (diarization substitute per ASR-BENCHMARK).
   - On stop: finalize transcript, optional template summary (`summary.md`), ingest graph node `kind: 'meeting'` + edges to bucket/tasks.
3. Tools: `capture_start`, `capture_stop`, `capture_status` (read for status). REST: `POST /capture/meetings/start|stop`, `GET /capture/meetings`, `GET /capture/meetings/:id`.
4. Default provider: local; Settings lets user switch to BYOK + pick model.

**Test:**

- Integration: mock audio fixture → partial transcripts appear; final file on disk; `context_search` finds meeting title/snippet.
- Unit: provider selection; sidecar crash → graceful error + retry once.

**Commit:** `feat(capture): meeting pipeline + TranscriptionProvider (M6.2)`

---

### M6.3 — Browsing learnings + research bucket `[seq → M3.1, M4.3]`

**What:** Opt-in passive observation → staged memory/skills; research threads with quotes.

**How:**

1. **Consent store:** migration `0010_*` table `capture_consents` (`domain`, `class` enum `meeting|browsing|research`, `bucket_id`, `allowed`, `updated_at`) — separate from `domain_grants` (which gates graph ingest deny). UI: Capture settings + per-domain toggles.
2. **Browsing observer:** `apps/server/src/capture/browsing-observer.ts` (or app-side with server POST):
   - On navigation to opted-in domain (cadence: debounce 30s per tab, skip `chrome://` / private), extract compact page digest via snapshot text (cap chars).
   - Extract facts/workflows with deterministic rules first (headings, repeated patterns); optional cheap model behind flag.
   - Writes: staged `memory_add` equivalent or queue for `review-job` — **never** direct `MEMORY.md` promote.
3. **Research bucket:** when `research` consent on + user toggles "Researching" (optional topic label in UI):
   - Record thread: ordered `graph_nodes` chain with `kind: 'research_page'`, edges `opened_from`, store verbatim quotes (user copy/highlight hook if available; else selected snippet with URL).
   - `context_search` returns snippets with `citation: { url, quote, capturedAt }`.
4. Bucket inference: suggest bucket from domain map (`github.com` → work); show toast/UI before first write; user can override in Capture UI.

**Test:**

- Integration: opt-in domain → browse → staged learning appears; non-opt-in → nothing.
- Research thread: 3 pages → chain in graph → search returns quotes with URLs.
- Injection sample in page → staged write rejected by `assertMemoryContent`.

**Commit:** `feat(capture): browsing learnings + research threads (M6.3)`

---

### M6.4 — Capture consent + untrusted-input handling `[seq]`

**What:** OFF by default; structural injection defense for capture.

**How:**

1. Defaults: all `capture_consents.allowed = false`; meetings require explicit start or per-domain meeting prompt once.
2. Wire glow to consent state — cannot capture without user action that enables glow.
3. Extend `trust-invariants.test.ts`:
   - Captured transcript containing "Ignore previous instructions" in a **tool result** does not change `buildSystemPrompt` output.
   - Captured content cannot set `__promoted` or bypass `needsApproval`.
4. Document in report: captured text path = tool result / staged memory only.
5. Protected domains default off: banking, payments, health, government TLD patterns (reuse or extend denylist patterns from workspace/trust).

**Test:**

- Property tests in `trust-invariants.test.ts` for capture vectors.
- Integration: capture off → `capture_start` rejected or no-op; enable one domain → only that domain browses.

**Commit:** `feat(capture): consent model + trust invariants (M6.4)`

---

### M6.5 — Capture UI + home widgets `[par → M6.2, M6.3]`

**What:** `#/capture` screen; enable adaptive home meeting/research widgets.

**How:**

1. `apps/app/screens/capture/`:
   - `CapturePage.tsx` — tabs: Meetings | Learnings | Research | Settings (consent).
   - Meetings list from `GET /capture/meetings`; detail view transcript + summary + link to graph.
   - Bucket picker (reuse `useContextBuckets`); reassign meeting/thread bucket.
   - Pause banner when `capturePausedReason` (battery/disk/load) from `GET /capture/status`.
2. Route: `#/capture` in `App.tsx`; sidebar/nav entry.
3. **Adaptive home** — extend:
   - `HomeWidgetType`: add `'next-meeting' | 'research-thread'`.
   - `scheduler/home.ts`: next meeting from upcoming calendar integration **if connected**, else from recent meeting capture nodes; research widget when active research thread exists.
   - `apps/app/screens/newtab/home/` — render new cards with actions (Join / Resume / Open notes).
4. CLI optional: `browseros-cli capture list|status` via MCP.

**Test:**

- App component tests for list/detail; home ranking includes meeting widget when data present.
- Manual: open past meeting → transcript; dismiss home widget → `USER.md` pref.

**Commit:** `feat(app): capture UI + home meeting/research widgets (M6.5)`

---

### M6.6 — Capture performance budget `[par]`

**What:** Pause on battery/disk/load; retention enforcement.

**How:**

1. `apps/server/src/capture/performance.ts`:
   - Subscribe to `battery.ts` — pause active capture + browsing observer when on battery (configurable, default on).
   - Disk check: if `getCaptureDir()` usage > threshold (e.g. 85% of quota or 10GB cap), pause + prune oldest **raw audio** first.
   - Load: skip browsing extraction when CPU high (simple heuristic: skip if previous extract took > N ms).
2. Retention job (server interval, like review job): delete raw audio past `retentionDaysRaw`; keep transcripts per `retentionDaysTranscript`.
3. Expose `GET /capture/status` → `{ paused, reason, diskUsageBytes }`.
4. UI shows "Capture paused (battery)" / "(disk full)" on Capture page + optional glow state.

**Test:**

- Unit: retention deletes old `.wav`/`.webm` not transcript json.
- Integration: mock `detectOnBattery true` → observer pauses; status endpoint reflects.

**Commit:** `feat(capture): performance budget + retention (M6.6)`

---

## Migration `0010_*` (suggested)

Tables (adjust names to match Drizzle style):

- `capture_consents` — domain, class, bucket_id, allowed, updated_at
- `capture_sessions` — id, bucket_id, kind, tab_id, url, status, started_at, ended_at, transcript_path
- `research_threads` — id, bucket_id, topic, status, created_at
- `research_thread_pages` — thread_id, node_id, order_index, quote, url

Mirror in `client.ts`. Link `capture_sessions` to `graph_nodes` where appropriate.

---

## Independent verification (required)

Paste into `PHASE-6-REPORT.md` before claiming ship gate:

1. **Primitive:** fork/API captures tab audio; glow on during capture; stop works.
2. **Meeting:** start → partials → final transcript on disk; searchable in Context.
3. **ASR:** local sidecar default; BYOK switch works; Web Speech not used.
4. **Browsing:** opt-in domain only → staged learning; opt-out domain → nothing.
5. **Research:** thread chain + quoted search results.
6. **Consent:** off by default; per-class + per-domain; bucket reassignment visible.
7. **Trust:** capture injection samples fail invariants; no auto-approve from captured text.
8. **UI:** `#/capture` meetings + pause states; home widgets when data exists.
9. **Perf:** battery pause; retention prunes raw audio.
10. **`0010_*` mirrored** in `client.ts`.
11. **No Phase 7+ leakage** (no packaging, reshape overlays, or feed classifier).
12. **No Pane-operated ASR/push.**

Recommended review: sidecar lifecycle, consent DB vs `domain_grants`, glow mode separation, staging path for learnings.

---

## Stop condition — do not auto-proceed to Phase 7

1. Full check + tests green.
2. Manual: capture a short test meeting (or fixture); browse opted-in domain; view transcript in UI; home widget appears.
3. Write `specs/PHASE-6-REPORT.md`.
4. **Stop.** Do not start Phase 7 (v1.0 packaging) unless explicitly asked. Page reshape is **Phase 9**; evolving home is **Phase 8**.

## What NOT to do

- No signed/notarized builds, auto-update, or Windows/Linux packaging (Phase 7) unless explicitly asked.
- No page reshape, fit scores, feed de-slop (Phase 9).
- No custom widget builder / NL widget creation (Phase 8).
- No video recording of meetings (audio + page content only).
- No Pane-hosted transcription or capture cloud.
- No silent capture or hidden glow.
- No auto-promote browsing learnings to `MEMORY.md` or active skills.
- No embedding whisper inside Bun — use sidecar.
- Do not break Phase 5 scheduler/reach/home; extend home widget types only.
- Do not push unless asked.

## If you hit a blocker

Append `BLOCKERS` to `specs/PHASE-6-REPORT.md` with file:line and smallest next step. Likely:

- (a) Fork patch too large for one PR → ship app+server path with `getDisplayMedia` fallback for Dev **only** behind flag; document fork follow-up — **report before silently using MV3 as primary**.
- (b) Sidecar Python dep → document install step + bundle path; tests mock provider.
- (c) Calendar not connected → next-meeting widget uses last capture + "no upcoming" honestly.
- (d) Diarization deferred → use page participant names; note in report.
- (e) Intel laptop ASR slow → flip default to BYOK on that profile per ASR-BENCHMARK follow-up; local still available.
