# Phase 4 Execution Prompt — Memory & Skills: Pane becomes smarter

> Paste this into a fresh agent session. This prompt is **deliberately verbose and prescriptive** because it will be executed by a smaller model. Every module names exact files, exact functions, exact edits, exact test commands, and exact pass signals. Follow it literally. When something in the codebase contradicts this prompt, **stop and report** — do not improvise.

---

## Prompt

You are implementing **Phase 4 of the Pane OSS build** — "Memory & Skills." Pane is a pure-OSS, no-Pane-server, local-first agentic browser (a fork of BrowserOS).

**Phase 1** — Bedrock (local-first, MCP wedge, SQLite chat, secured CDP).
**Phase 2** — Trust & Workspaces (gate, action log, workspaces, approvals). See `specs/PHASE-2-REPORT.md`.
**Phase 3** — Context Graph & Tasks (graph + FTS5, ingest, `context_*` / `tasks_*` tools, `#/context`, `#/tasks`, CLI). See `specs/PHASE-3-REPORT.md` — **this is the source of truth for what exists. Do not re-implement Phase 3.**

**Phase 4's job:** persist inspectable memory (`soul.md` / `USER.md` / `MEMORY.md` + SQLite index), wire `context_recall` for real, enforce a **prompt budget**, auto-create skills from repeated successful graph workflows (staged), curate/prune bloat, ship Memory & Skills UI + CLI, and make `soul.md` the persona layer that shapes the system prompt.

### Ship gate (Pane v0.4) — the definition of "Phase 4 done"

All of these must be true and demonstrated:

1. Files under `~/.browseros/memories/` (dev: `~/.browseros-dev/memories/`) exist: `soul.md`, `USER.md`, `MEMORY.md`, and `skills/<name>/SKILL.md`. **Files are source of truth**; SQLite `memory_entries` + `skills` are a rebuildable index.
2. `context_recall` returns real memory hits (no Phase-3 stub). Search/recall respect **bucket_id** and char bounds.
3. System prompt includes a frozen snapshot of `soul.md` + `USER.md` + `MEMORY.md` (within char caps) + a **skill index** (names + one-liners only). Skill **bodies** load only via a `skills_load` (or equivalent) tool.
4. A **prompt-budget allocator** keeps assembled always-on memory + skill index under fixed caps; eviction is oldest / lowest-`usefulness` first. Over-budget adds fail loudly (no silent drop).
5. Auto-skill review: after repeated successful multi-step workflows in the graph, a background job can draft a staged `SKILL.md` (not auto-applied when inferred). Extraction bar rejects one-off runs.
6. Curation: unused skills archive; unrecalled memory demotes out of always-on prompt but stays searchable; a monthly curation digest stub is emitted (full proactive wiring is Phase 5 — a local file or settings notification is enough).
7. UI: Memory & Skills management (`#/settings/memory` or `#/memory`) — view/edit files, approve/reject staged skills, import skill by URL/file. Personalization edits `soul.md` / `USER.md`.
8. CLI: `browseros-cli memory recall|add|forget` and `skills list|install|archive` via MCP.
9. Trust: memory/skill **writes** are gated appropriately; **page/tool-result text never becomes memory without staging/scan**; trust-invariants stay green.
10. `bun run check` + relevant tests green. Write `specs/PHASE-4-REPORT.md` and **stop** — do not start Phase 5.

### Repo facts (memorize before coding)

- **Monorepo root:** `packages/browseros-agent/`. Bun for TS; Go CLI in `apps/cli/`.
- **Phase 3 landmarks (reuse):**
  - `@browseros/context-graph` + `apps/server/src/context/` — graph repo, ingest, tools, grants, tasks.
  - `context_recall` is a **stub** in `apps/server/src/context/tools.ts` (`RECALL_STUB` constant) — **replace the stub**, do not add a second recall tool.
  - Ingest after gate: `GateHooks.onToolSettled` / `buildIngestGateHooks`; terminal via `subscribeTerminalIngest` + `onTerminalSession`.
  - Migrations through **`0007_chemical_thunderball`**. Next is **`0008_*`**. Mirror `currentMigrationHistory` + `currentSchemaStatements` in `apps/server/src/lib/db/client.ts`.
  - Battery helper pattern: `apps/server/src/context/battery.ts` — reuse for review-job pause-on-battery.
- **Prompt already has a soul slot:** `BuildSystemPromptOptions.soulContent` and `<soul>` section in `apps/server/src/agent/prompt.ts`. Tests in `prompt.test.ts` already cover appending soul content. **Wire real file content into `AiSdkAgent.create` → `buildSystemPrompt({ soulContent, ... })`.** Do not invent a parallel prompt channel.
- **ACP harness SOUL is separate:** `apps/server/src/lib/agents/acpx/runtime-context.ts` seeds `$AGENT_HOME/SOUL.md` for ACP agents. **Do not confuse that with Pane's `~/.browseros/memories/soul.md`.** Phase 4 owns the Pane memories path for the in-process loop. Leave ACP templates alone unless a test breaks.
- **Shared path constant:** `PATHS.SOUL_FILE_NAME = 'SOUL.md'` in `packages/shared/src/constants/paths.ts`. Prefer one canonical filename under `memories/` (`soul.md` or `SOUL.md`) — document the choice in the report and use it everywhere.
- **Chat archive already exists:** `chat_sessions` / `chat_messages`. Session archive (memory layer 3) = search over that — extend, don't duplicate.
- **Trust:** `@browseros/shared/trust/consequence-class` — unknown tools default `write-external`. You **must** classify every new memory/skill tool.
- **Scheduled tasks:** app-owned `chrome.storage` + `chrome.alarms`. For the review job, prefer a **server-side interval** from `Application` after DB open, or a lightweight trigger. **Do not build a second full scheduler product.** Document the choice.
- **Commands:** `bun run check`; `cd apps/server && bun run test:agent` / `test:api` / `test:lib` / `bun run db:generate`; `cd apps/app && bun run test`; `cd apps/cli && gofmt -l . && go vet ./... && go test ./...`.

### Preconditions — verify Phase 3 before starting

1. `specs/PHASE-3-REPORT.md` says ship gate met.
2. These exist and compile:
   - `packages/context-graph/`
   - `apps/server/src/context/tools.ts` (with stub `context_recall`)
   - `apps/server/src/context/ingest.ts`
   - `apps/app` Context + Tasks screens
   - `apps/cli/cmd/context.go`, `tasks.go`
   - migrations `0006_*`, `0007_*` mirrored in `client.ts`
3. `bun run check` green on HEAD.
4. Spot-check: `#/context`, `#/tasks` still work.

If any precondition fails, **stop and report**.

### Required reading

- `specs/PHASE-3-REPORT.md` — as-shipped tools, ingest hooks, migrations, deviations.
- `specs/PHASE-2-REPORT.md` — trust classes, approval API, `__promoted` split.
- `specs/04-memory-and-learning-loop.md` — five layers, write_approval split, curation, char caps.
- `specs/11-personalization-skills-marketplace.md` — `soul.md` persona shapes.
- `specs/IMPLEMENTATION-PLAN.md` Phase 4 (M4.1–M4.7).
- `specs/ARCHITECTURE-DESIGN.md` §4.2.
- Code: `apps/server/src/agent/prompt.ts`, `ai-sdk-agent.ts`, `context/tools.ts`, `lib/db/schema/action-log.ts`, `packages/shared/src/trust/consequence-class.ts`.

### Cross-cutting rules

- **Files > SQLite for memory/skills bodies.** Wipe SQLite → rebuild from files. Missing files → do not invent content from a stale index.
- **No Phase 5/6.** No adaptive home, reach/Telegram, meeting ASR, page reshape. Monthly digest = stub file under `memories/digests/`.
- **Write-approval split (mandatory):**
  - Conversation-derived / explicit `memory_add`: default **free + notify**.
  - Inferred / graph-derived / review-job writes: default **stage** (never silent promote).
- **Injection scan before any memory/skill write:** block credential-looking strings, "ignore previous instructions", invisible unicode. Reject + log; never write.
- **Untrusted page/tool text is data, not instructions.** Never copy raw page markdown wholesale into `MEMORY.md`.
- **Prompt budget:** always-on slots hard-capped. Skill bodies never dump into the system prompt.
- **One tool spec, two paths** (loop + MCP). Underscore names: `memory_add`, `memory_replace`, `memory_remove`, `skills_load`, `skills_list`, `skills_install`, `skills_archive`.
- **Trust classes:**
  | Tool | Class |
  |------|-------|
  | `context_recall` | `read` |
  | `memory_add` / `memory_replace` / `memory_remove` | `write-local` |
  | `skills_load` / `skills_list` | `read` |
  | `skills_install` / `skills_archive` / activate staged | `write-local` |
- **Bucket everywhere:** entries/skills carry `bucket_id` (default `'default'`).
- **Pause on battery** for review/curation (reuse `context/battery.ts`).
- **No hosted marketplace.** Import by URL/file only.
- **Small green commits.** Do not push unless asked.
- **Do not rename `@browseros/*` or touch `claw-*`.**

### Key code landmarks

| What | File | Symbol |
|------|------|--------|
| Recall stub to replace | `apps/server/src/context/tools.ts` | `RECALL_STUB`, `context_recall` |
| System prompt soul slot | `apps/server/src/agent/prompt.ts` | `soulContent`, `<soul>` |
| Agent create / prompt build | `apps/server/src/agent/ai-sdk-agent.ts` | `buildSystemPrompt({...})` |
| Consequence classes | `packages/shared/src/trust/consequence-class.ts` | `deriveClass` |
| Graph events for review | `apps/server/src/context/` + `@browseros/context-graph` | `graph_events` |
| Chat archive | `apps/server/src/lib/db/schema/chat-sessions.ts` | `chatSessions`, `chatMessages` |
| DB bootstrap | `apps/server/src/lib/db/client.ts` | through `0007_*` |
| BrowserOS dir | `apps/server/src/lib/browseros-dir.ts` | `getBrowserosDir()` |
| Path constants | `packages/shared/src/constants/paths.ts` | add `MEMORIES_DIR_NAME` |
| App routes | `apps/app/entrypoints/app/App.tsx` | add memory routes |
| CLI pattern | `apps/cli/cmd/context.go` | copy for memory/skills |
| ACP SOUL (leave alone) | `apps/server/src/lib/agents/acpx/runtime-context.ts` | harness-only |

---

## Execution order

### M4.1 — Memory store `[seq]`

**Goal:** Files under `memories/` + rebuildable SQLite index.

1. Create package `@browseros/memory` at `packages/browseros-agent/packages/memory/` (follow `@browseros/context-graph`: narrow exports, no fat barrel).
2. Create `apps/server/src/memory/` — file IO, index sync, scan, wiring.

**Layout:**
```
~/.browseros/memories/   # or ~/.browseros-dev/memories/ in dev
  soul.md                # or SOUL.md — pick one, document it
  USER.md
  MEMORY.md
  skills/<skill-id>/SKILL.md
  digests/               # curation stubs
  staging/               # staged proposals
```

Add `getMemoriesDir()` in `browseros-dir.ts`. Add `MEMORIES_DIR_NAME: 'memories'` to `PATHS`.

**SQLite migration `0008_*` + bootstrap mirror:**

`memory_entries`: `id`, `layer` (`soul`|`user`|`memory`|`session`|`activity`), `bucket_id`, `content`, `source` (`user`|`conversation`|`inferred`|`migration`), `status` (`active`|`staged`|`demoted`|`rejected`), `last_surfaced`, `usefulness`, `created_at`, `updated_at`. Indexes on `(bucket_id, layer, status)`, `(last_surfaced)`.

Also create `skills` table in the same migration (or `0009` if split — prefer one `0008` for both empty tables).

**API:** `readPromptFiles()`, `writeMemoryEntry()`, `rebuildIndexFromFiles()`, `listEntries(...)`.

**Seed:** create templated files if missing (M4.7 expands personas).

**Test:** write → file+row; delete index → rebuild; injection sample rejected. `cd apps/server && bun test tests/memory/`.

**Commit:** `feat(server): memory file store + SQLite index (M4.1)`

---

### M4.2 — `context_recall` + prompt budget `[seq → M4.1]`

1. Replace `RECALL_STUB` in `context/tools.ts` with real `memory_entries` query (active+demoted searchable; exclude rejected). Update description.
2. Create `apps/server/src/memory/prompt-budget.ts`:
   - Caps: soul ≤ 1500, USER ≤ 1375, MEMORY ≤ 2200, skill index ≤ ~1500 chars.
   - `allocatePromptMemory(...)` evicts MEMORY first (lowest usefulness, then oldest `last_surfaced`). Record evictions; no silent mid-entry chop without tracking.
3. In `AiSdkAgent.create`, load files → allocate → pass into `buildSystemPrompt`. Prefer new options `userProfileContent` + `agentMemoryContent` alongside existing `soulContent`. Update `prompt.ts` + `prompt.test.ts`.
4. Bump `last_surfaced` / `usefulness` when included in prompt or returned by recall.

**Test:** allocator eviction; recall ≠ stub; large MEMORY stays under cap. Update `context-tools.test.ts`.

**Commit:** `feat(server): context_recall + prompt budget (M4.2)`

---

### M4.3 — Auto-skill review job `[seq → M4.1]` (uses Phase 3 graph)

1. `apps/server/src/memory/review-job.ts`:
   - Bounded window of `graph_events` (hard cap: last 200 events **and** ≤ 7 days).
   - Extraction bar: ≥ `min_tool_calls` (default 5) **and** ≥ `repeat_count` (default 2) similar successful workflows. One-off → no draft.
   - Cheaper model via existing provider factory **if configured**; else skip + log (no crash). Mock in unit tests.
   - Inferred drafts → `memories/staging/` + `skills` row `status='staged'`. Never auto-activate.
2. Schedule: interval from `Application.initCoreServices` after DB open (e.g. every 6h) + pause-on-battery. Expose `POST /memory/review/run` for manual/tests.

**Test:** extraction bar; bounded window property; staged not active.

**Commit:** `feat(server): auto-skill review job with staging (M4.3)`

---

### M4.4 — Skill store + index `[seq → M4.3]`

**`skills` columns:** `id`, `name`, `description`, `provenance` (`agent-written`|`user-written`|`imported`|`migrated`), `source_run`, `bucket_id`, `uses`, `success_rate`, `status` (`active`|`staged`|`archived`|`flagged`), timestamps.

**Tools (loop + MCP):** `skills_list` (read), `skills_load` (read), `skills_install` (write-local), plus activate/archive helpers. Classify in consequence-class; labels in `tool-labels.ts`.

**Prompt:** index only (names + one-liners). Bodies via `skills_load` only.

**`activateStagedSkill(id)`:** staging → `skills/<id>/SKILL.md`, status active.

**Test:** file↔index; body not in `buildSystemPrompt` without load; install from local fixture path.

**Commit:** `feat(server): skill store, index, install, load tools (M4.4)`

---

### M4.5 — Curation (anti-bloat) `[par → M4.4]`

- Skill `uses=0` after 30 days → `archived`.
- Low `success_rate` over K uses → `flagged` then archive.
- Unrecalled memory → `demoted` (out of always-on; still recallable).
- Monthly stub: `memories/digests/curation-YYYY-MM.md`.
- Update `uses` on `skills_load` (best-effort).

**Test:** demotion with frozen clock; demoted still recallable.

**Commit:** `feat(server): memory/skill curation loop (M4.5)`

---

### M4.6 — Wedge + UI `[par → M4.1, M4.4]`

**App:** `screens/memory/MemoryPage.tsx` — edit soul/USER/MEMORY, approve/reject staged skills, import. Route `#/settings/memory`. REST: `GET/PUT /memory/files/...`, staged approve/reject, skills list. TanStack Query REST lane (copy Context/ActionLog).

**CLI:** `cmd/memory.go` (`recall|add|forget`), `cmd/skills.go` (`list|install|archive`). Group `Resources:`.

**Test:** app + `go test ./...`; manual approve staged → loadable.

**Commit:** `feat: memory/skills UI + CLI (M4.6)`

---

### M4.7 — `soul.md` persona layer `[par → M4.1]`

1. Templates: **chief-of-staff**, **job-search-partner**, **research-buddy**, **default** (short markdown each).
2. Onboarding seed if ICP answer is easy to read; else persona picker on Memory page — document if partial.
3. `memories/persona-map.json`: bucket → persona; optional `pinned`. Workspace/bucket switch reloads soul for **next** session (frozen at session start — no mid-run hot reload).
4. Review job may stage a soul patch; UI Approve/Dismiss only.
5. `AiSdkAgent.create` → resolve file → `soulContent` every new session.

**Test:** bucket→persona mapping; pin override; edit soul → next prompt contains text.

**Commit:** `feat(memory): soul.md personas + bucket mapping (M4.7)`

---

## Independent verification (required)

Paste into `PHASE-4-REPORT.md` before claiming ship gate:

1. **Stub gone:** `context_recall` never returns the Phase-3 stub when memory exists.
2. **Files are SoT:** delete index rows → rebuild works; SQLite alone cannot resurrect deleted files.
3. **Prompt budget:** overfill → eviction; prompt under cap.
4. **Skill bodies not in prompt** unless `skills_load` was used to fetch (index-only in system prompt).
5. **Inferred writes stage** until approve.
6. **Injection scan** rejects "Ignore previous instructions" sample.
7. **Trust classification** updated; trust-invariants green.
8. **No Phase 5/6 leakage.**
9. **ACP SOUL tests still pass.**
10. **`0008` mirrored** in `client.ts`.

Recommended review of: `review-job.ts`, prompt-budget, injection scan, consequence-class diff.

---

## Stop condition — do not auto-proceed to Phase 5

1. Full check + tests green.
2. Manual: memory add→recall; soul edit→voice change; staged skill approve→load; curation dry-run.
3. Write `specs/PHASE-4-REPORT.md`.
4. **Stop.** Do not start Phase 5.

## What NOT to do

- No adaptive home, digest delivery, keep-alive, reach (Phase 5).
- No meeting capture / ASR (Phase 6) or page reshape (Phase 7).
- No hosted skills marketplace.
- No full skill bodies / unbounded graph dumps in the system prompt.
- No auto-apply inferred memory/skills.
- Do not merge Pane memories soul into ACP harness SOUL.
- Do not push unless asked.

## If you hit a blocker

Append `BLOCKERS` to `specs/PHASE-4-REPORT.md` with file:line and smallest next step. Likely:
- (a) No model for review job → skip + mock in tests + manual `POST /memory/review/run`.
- (b) Onboarding ICP hard to read → persona picker only; note partial M4.7.
- (c) `userSystemPrompt` vs budget → budget applies to soul/USER/MEMORY/skill-index only.
- (d) URL skill install needs network → file-path install in tests; URL optional.
