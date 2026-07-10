# Phase 4 Report — Memory & Skills

Status: **ship gate met** — M4.1–M4.7 complete (including ICP onboarding seed + URL skill install). Phase 1–3 approval-resume / transcript-patch debt included on this branch. Phase 5 not started.

## Canonical filenames

Under `~/.browseros/memories/` (dev: `~/.browseros-dev/memories/`):

| File | Notes |
|------|--------|
| `SOUL.md` | Persona layer; reuses `PATHS.SOUL_FILE_NAME`. Distinct from ACP harness `$AGENT_HOME/SOUL.md`. |
| `USER.md` | User profile (seeded from onboarding profile + ICP) |
| `MEMORY.md` | Agent notes (bullets) |
| `skills/<id>/SKILL.md` | Active skills |
| `staging/<id>.md` | Inferred drafts awaiting approve/reject |
| `digests/curation-YYYY-MM.md` | Monthly curation stub (Phase 5 delivers proactively) |
| `persona-map.json` | bucket → persona + optional pin |

**Files are source of truth.** SQLite `memory_entries` + `skills` (migration `0008_bored_karen_page`) are a rebuildable index via `rebuildIndexFromFiles()`.

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M4.1 Memory store | **done** | `@browseros/memory` + `apps/server/src/memory/`; injection scan; seed templates |
| M4.2 `context_recall` + budget | **done** | Stub removed; caps soul≤1500 / USER≤1375 / MEMORY≤2200 / skill-index≤1500 |
| M4.3 Auto-skill review | **done** | Server `setInterval` 6h from `Application.initCoreServices`; pause-on-battery; `POST /memory/review/run` |
| M4.4 Skill store + tools | **done** | `skills_list/load/install/archive` + activate staged; index-only in prompt; **path or https URL** |
| M4.5 Curation | **done** | Unused→archive; unrecalled→demoted; digest stub under `digests/` |
| M4.6 UI + CLI | **done** | `#/settings/memory`; `browseros-cli memory|skills` via MCP |
| M4.7 Personas | **done** | Templates + Memory picker + **onboarding ICP step** → `POST /memory/personas/apply` + USER.md seed |

## Review schedule choice

**Server-side interval** (`startMemoryReviewMonitor`, 6h) after DB open — not a second chrome.alarms scheduler product. Manual trigger: `POST /memory/review/run`.

## Tool names (wire)

| Tool | Class | Surfaces |
|------|-------|----------|
| `context_recall` | `read` | loop + MCP + CLI `memory recall` |
| `memory_add` / `memory_replace` / `memory_remove` | `write-local` | loop + MCP + CLI |
| `skills_list` / `skills_load` | `read` | loop + MCP + CLI |
| `skills_install` / `skills_archive` | `write-local` | loop + MCP + CLI (`install` accepts path or URL) |

## Prompt wiring

`AiSdkAgent.create` → `loadPromptMemorySnapshot` → `buildSystemPrompt({ soulContent, userProfileContent, agentMemoryContent, skillIndexContent })`. Skill **bodies** never enter the system prompt; use `skills_load`.

ACP harness SOUL seeding in `acpx/runtime-context.ts` left untouched.

## Write-approval split

- Conversation/user `memory_add`: free + notify (gated `write-local`).
- Inferred / review-job skills: **staged** only (`status='staged'`, files under `staging/`). Never auto-activate.

## Onboarding ICP → persona

| ICP (`local:onboardingIcp`) | Persona |
|-----------------------------|---------|
| `coding` / `privacy` | `default` |
| `research` | `research-buddy` |
| `personal-automation` | `chief-of-staff` |
| `job-search` | `job-search-partner` |

On demo complete: `seedMemoryFromOnboarding` applies persona (if map empty) and writes `USER.md` from profile + ICP. Memory page picker remains available.

## URL skill install

`installSkillFromUrl`: https only (http localhost for tests), `TIMEOUTS.SKILL_FETCH` (15s), max 256KB, injection scan via `installSkillFromBody`. Wired in tool, REST `POST /memory/skills/import` (`path` XOR `url`), CLI, and Memory UI.

## Independent verification

1. **Stub gone:** `context_recall` returns memory hits; tests assert no Phase-3 stub text.
2. **Files are SoT:** delete index → `rebuildIndexFromFiles`; forget removes file line so rebuild cannot resurrect.
3. **Prompt budget:** allocator evicts lowest usefulness / oldest `last_surfaced`; over-budget add throws `PromptBudgetExceededError`.
4. **Skill bodies not in prompt:** index-only; body via `skills_load` after activate.
5. **Inferred writes stage:** review job + `source:'inferred'` → staged.
6. **Injection scan:** rejects "Ignore previous instructions" (memory writes + URL install).
7. **Trust classification:** memory/skill tools classified; trust-invariants green.
8. **No Phase 5/6 leakage:** digest is a local file stub only.
9. **ACP SOUL tests:** `provider-factory-acp` + `acp-instructions` pass.
10. **`0008` mirrored** in `client.ts` `currentMigrationHistory` + `currentSchemaStatements`.
11. **ICP seed:** onboarding step + `personaIdForIcp` + server `applyPersonaTemplate` covered by tests.
12. **URL install:** mocked fetch install + reject oversized / non-https / injection.

## Phase 1–3 debt included on this branch

- Shared `SessionStore` across `/chat` and `/trust/replay` so promote patches live + SQLite transcript (`patchConversationToolOutput`).
- Sidepanel forwards `toolApprovalResponses` / workspace / trust pins on resume.
- Live E2E notes updated in PHASE-1/2/3 reports.

## Deviations / limitations

1. Review drafter uses a deterministic template when no cheaper model is configured (logs + stages; no crash). Inject `draftSkill` in tests / `POST /memory/review/run`.
2. `userSystemPrompt` is outside the memory budget (budget applies to soul/USER/MEMORY/skill-index only).
3. Soul-patch proposals from the review job are not yet a separate UI surface (persona changes go through Memory page / ICP seed).

## Tests run (automated)

```text
cd packages/browseros-agent && bun run check   # lint + typecheck + fallow (exit 0)

cd apps/server && bun run typecheck
cd apps/server && bun run test:agent          # 353 pass (incl. ACP + context_recall)
cd apps/server && bun run ./tests/__helpers__/run-test-group.ts memory  # 24 pass
cd apps/server && bun test --preload=./tests/__helpers__/test-env.ts --max-concurrency=1 \
  tests/memory/ tests/agent/provider-factory-acp.test.ts \
  tests/agent/context-tools.test.ts tests/api/services/mcp/register-mcp.test.ts \
  tests/agent/trust-invariants.test.ts tests/api/services/chat-service.test.ts
# Cross-file mock isolation: ACP fs/browseros-dir mocks no longer poison later suites.

cd apps/app && bun run typecheck && bun test  # 294 pass (incl. icp.test.ts)

cd apps/cli && gofmt -l . && go vet ./... && go test ./...
```

Pre-existing (not Phase 4): `test:api` still errors on removed Klavis modules (`tests/api/services/klavis/*`). Phase-4 MCP/chat/trust paths above are green.

## Commits (this phase)

- `feat(server): memory file store + SQLite index (M4.1)`
- `feat(server): context_recall + prompt budget (M4.2)`
- `feat: skill review, store, curation, UI, CLI, personas (M4.3–M4.7)`
- `docs: add Phase 4 ship-gate report`
- `fix: finish approval-resume transcript patch and Phase 1–3 smoke notes`
- `feat(memory): ICP onboarding seed + URL skill install` (this follow-up)

## BLOCKERS

None.

## Stop

Phase 4 complete. **Do not start Phase 5** until explicitly asked.
