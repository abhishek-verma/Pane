# Phase 4 Report — Memory & Skills

Status: **ship gate met** — M4.1–M4.7. Phase 5 (proactive / adaptive home / reach) not started.

## Canonical filenames

Under `~/.browseros/memories/` (dev: `~/.browseros-dev/memories/`):

| File | Notes |
|------|--------|
| `SOUL.md` | Persona layer; reuses `PATHS.SOUL_FILE_NAME`. Distinct from ACP harness `$AGENT_HOME/SOUL.md`. |
| `USER.md` | User profile |
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
| M4.4 Skill store + tools | **done** | `skills_list/load/install/archive` + activate staged; index-only in prompt |
| M4.5 Curation | **done** | Unused→archive; unrecalled→demoted; digest stub under `digests/` |
| M4.6 UI + CLI | **done** | `#/settings/memory`; `browseros-cli memory|skills` via MCP |
| M4.7 Personas | **done** | Templates + picker on Memory page; `persona-map.json`; frozen at session start |

## Review schedule choice

**Server-side interval** (`startMemoryReviewMonitor`, 6h) after DB open — not a second chrome.alarms scheduler product. Manual trigger: `POST /memory/review/run`.

## Tool names (wire)

| Tool | Class | Surfaces |
|------|-------|----------|
| `context_recall` | `read` | loop + MCP + CLI `memory recall` |
| `memory_add` / `memory_replace` / `memory_remove` | `write-local` | loop + MCP + CLI |
| `skills_list` / `skills_load` | `read` | loop + MCP + CLI |
| `skills_install` / `skills_archive` | `write-local` | loop + MCP + CLI |

## Prompt wiring

`AiSdkAgent.create` → `loadPromptMemorySnapshot` → `buildSystemPrompt({ soulContent, userProfileContent, agentMemoryContent, skillIndexContent })`. Skill **bodies** never enter the system prompt; use `skills_load`.

ACP harness SOUL seeding in `acpx/runtime-context.ts` left untouched.

## Write-approval split

- Conversation/user `memory_add`: free + notify (gated `write-local`).
- Inferred / review-job skills: **staged** only (`status='staged'`, files under `staging/`). Never auto-activate.

## Independent verification

1. **Stub gone:** `context_recall` returns memory hits; tests assert no Phase-3 stub text.
2. **Files are SoT:** delete index → `rebuildIndexFromFiles`; forget removes file line so rebuild cannot resurrect.
3. **Prompt budget:** allocator evicts lowest usefulness / oldest `last_surfaced`; over-budget add throws `PromptBudgetExceededError`.
4. **Skill bodies not in prompt:** index-only; body via `skills_load` after activate.
5. **Inferred writes stage:** review job + `source:'inferred'` → staged.
6. **Injection scan:** rejects "Ignore previous instructions".
7. **Trust classification:** memory/skill tools classified; trust-invariants green.
8. **No Phase 5/6 leakage:** digest is a local file stub only.
9. **ACP SOUL tests:** `provider-factory-acp` + `acp-instructions` pass.
10. **`0008` mirrored** in `client.ts` `currentMigrationHistory` + `currentSchemaStatements`.

## Deviations / limitations

1. Review drafter uses a deterministic template when no cheaper model is configured (logs + stages; no crash). Inject `draftSkill` in tests / `POST /memory/review/run`.
2. Onboarding ICP → persona seed is **partial**: Memory page persona picker ships; no onboarding ICP auto-read.
3. URL skill install not implemented; **file-path** install works (CLI + UI + `skills_install`).
4. `userSystemPrompt` is outside the memory budget (budget applies to soul/USER/MEMORY/skill-index only).
5. Unrelated WIP may remain on the branch (approval-resume / patch-conversation) — not part of Phase 4 commits.

## Tests run (automated)

```text
cd packages/browseros-agent/apps/server && bun test tests/memory/ \
  tests/agent/context-tools.test.ts tests/agent/trust-invariants.test.ts \
  tests/api/services/mcp/register-mcp.test.ts \
  tests/agent/provider-factory-acp.test.ts tests/agent/acp-instructions/
# pass

cd apps/app && bun run typecheck && bun test
# 292 pass

cd apps/cli && gofmt -l . && go vet ./... && go test ./...
# pass

cd apps/server && bun run typecheck
# pass
```

## Commits (this phase)

- `feat(server): memory file store + SQLite index (M4.1)`
- `feat(server): context_recall + prompt budget (M4.2)`
- `feat: skill review, store, curation, UI, CLI, personas (M4.3–M4.7)`
- `docs: add Phase 4 ship-gate report` (this file)

## BLOCKERS

None for ship gate. Partial M4.7 onboarding ICP noted above.

## Stop

Phase 4 complete. **Do not start Phase 5** until explicitly asked.
