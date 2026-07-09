# Phase 3 Report — Context Graph & Tasks

Status: **ship gate met for automated evidence** — M3.1–M3.7 implemented on branch `feat/phase-3-context-graph-tasks`. Manual E2E (boot pane → navigate/write/bash → `#/context` → deny domain → tasks promote → CLI) still recommended before tagging v0.3. See BLOCKERS (none blocking automated gate).

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M3.1 Graph store + FTS5 | **done** | `@browseros/context-graph`, migration `0006_low_white_tiger`, bootstrap mirrored |
| M3.2 Event ingest | **done** | Post-gate `onToolSettled`; terminal via `onTerminalSession`; private/chrome skipped |
| M3.3 Buckets + Context panel + grants | **done** | `#/context`, domain_grants, `/context/*` routes |
| M3.4 context_* tools | **done** | Loop + MCP; `context_recall` stub; classified `read` |
| M3.5 Tasks inbox | **done** | `tasks`/`task_links`, `#/tasks`, client-side promote to scheduled |
| M3.6 CLI context/tasks | **done** | `browseros-cli context search\|current`, `tasks list\|add\|done` |
| M3.7 Batching + battery + eval | **done** | 50/200ms batcher; macOS `pmset` pause; `browsing-quality-with-graph` scenario |

## Schema / FTS approach

- Tables: `buckets`, `graph_nodes`, `graph_edges`, `graph_events`, FTS5 `graph_index`, `domain_grants`, `tasks`, `task_links`.
- **FTS5:** standalone virtual table synced on write (not `content=` binding) because nodes use text PKs. Documented in `@browseros/context-graph/repo`.
- Migrations: `0006_low_white_tiger` (graph), `0007_chemical_thunderball` (grants + tasks). Both mirrored in `client.ts` `currentMigrationHistory` + `currentSchemaStatements`.
- Default bucket seeded: `id='default', name='Default', kind='general'`.

## Ingest hook placement

- **Loop:** `wrapToolWithGate` / `wrapToolSetWithGate` optional `GateHooks.onToolSettled` → `buildIngestGateHooks` from `AiSdkAgent.create`.
- **Filesystem MCP:** `gateExecute(..., ingestHooks)` in `register-mcp.ts`.
- **Browser MCP:** `onToolSettled` on `registerBrowserTools` → `ingestToolResult`.
- **Terminal:** `subscribeTerminalIngest()` in `Application.initCoreServices` after DB open; listens to Phase 2 `onTerminalSession`.
- Ingest runs **after** successful settlement only — never instead of the gate; never calls `filesystem_write` itself.

## Tool names (wire)

| Tool | Class | Surfaces |
|------|-------|----------|
| `context_current_work` | `read` | loop + MCP + CLI |
| `context_search` | `read` | loop + MCP + CLI |
| `context_recall` | `read` | loop + MCP (stub message) |
| `tasks_list` | `read` | loop + MCP + CLI |
| `tasks_add` | `write-local` | loop + MCP + CLI |
| `tasks_done` | `write-local` | loop + MCP + CLI |

## Grant model

- SQLite `domain_grants(domain, bucket_id, allowed, updated_at)`.
- Visited hosts get implicit allow on first Context grants fetch; user can deny.
- `context_search` / `current_work` / tools filter via `getDeniedHosts`.

## Promote-schedule ownership

- **App-owned.** `#/tasks` opens `NewScheduledTaskDialog`, `useScheduledJobs().addJob` writes chrome.storage scheduled job, then `PATCH /tasks/:id` with `scheduledJobId`.
- Server `POST /tasks/:id/promote-schedule` only stores the link if the client already created the job. No second scheduler.

## Browsing-quality numbers

- Baseline scenario unchanged: `browsing-quality-baseline`.
- Sibling: `browsing-quality-with-graph` (same navigate task, `graph_ingest: true`, absolute CI cap `max_latency_ms: 45_000` ≈ baseline + 25% headroom).
- Synthetic FTS: 1000 events → search &lt;100ms locally (unit test).

## Independent verification checklist

1. **Trust classification:** `deriveClass('context_*')` → `read`; `tasks_add`/`tasks_done` → `write-local`; unknown → `write-external`. Covered in `context-tools.test.ts` + trust-invariants green.
2. **Ingest cannot bypass gate:** hooks only after `underlyingExecute` / post-approval execute.
3. **Incognito / chrome URLs:** unit tests — private creates none; `chrome://` skips page nodes.
4. **Domain deny:** API + tool tests exclude denied hosts.
5. **FTS injection:** `toFtsMatchQuery` sanitizes; MATCH uses bound parameter.
6. **No memory system:** `context_recall` stub only; no `~/.browseros/memories/`.
7. **Migration bootstrap:** `tests/lib/db/index.test.ts` expects graph + grants + tasks tables on bootstrap.

## Deviations / limitations

1. **Incognito detection:** server relies on `browserContext.isPrivate` when provided; if missing, still skips empty/`chrome://`/`chrome-extension://`/`about:` URLs. Honest gap if the extension does not set `isPrivate`.
2. **Battery pause:** macOS `pmset -g batt` best-effort, cached 30s. Non-macOS: no auto-pause (pref exists). Context panel shows "Indexing paused (battery)" when paused.
3. **Terminal bucketId:** uses `workspace.bucketId` from the session event (added in M3.2).
4. **Eval latency grader:** scenario records budget metadata; no separate `latency-budget` grader class yet — absolute cap documented for CI operators.
5. Working tree may still contain unrelated pre-Phase-3 WIP (workflows, claw, etc.) — Phase 3 commits are scoped.

## Tests run (automated)

```text
cd apps/server && bun test tests/agent/context-tools.test.ts \
  tests/api/routes/context-tasks.test.ts tests/lib/db/index.test.ts \
  tests/lib/context-graph.test.ts tests/agent/context-ingest.test.ts \
  tests/agent/trust-invariants.test.ts
# 66 pass

cd apps/server && bun run typecheck   # green for Phase 3 paths
cd apps/cli && gofmt -l . && go vet ./... && go test ./...
```

## Commits (this phase)

- `feat(server): context graph store + FTS5 (M3.1)`
- `feat(server): context graph ingest from tools + terminal (M3.2)`
- (follow-up commit(s) for M3.3–M3.7 + this report)

## BLOCKERS

None for automated ship gate. Manual smoke before tag recommended.

## Stop

Phase 3 complete for implementation. **Do not start Phase 4** (Memory / soul.md).
