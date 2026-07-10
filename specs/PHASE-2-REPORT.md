# Phase 2 Report — Trust & Workspaces

Status: **ship gate met** — all modules implemented; automated verification green. Manual E2E against live Pane Dev + DeepSeek recorded 2026-07-10 (CDP=9699, Server=9223).

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M2.1 Workspace object model | **done** | `Workspace`, terminal denylist, `buildFilesystemToolSet(workspace)` |
| M2.2 Trust gate | **done** | Single gate in shared + server; loop + filesystem MCP + browser MCP |
| M2.3 Action log | **done** | SQLite `action_log`, `GET /action-log`, Replay via `POST /trust/replay` |
| M2.4 Approval UI + pins | **done** | Approve / deny / edit / promote; approval-resume restored (PR #10) |
| M2.5 Terminal sessions | **done** | Named sessions + `onTerminalSession` hook |
| M2.6 Multi-workspace UI + file browser | **done** | `#/workspaces`, switcher, file APIs |
| M2.7 Trust invariants | **done** | `trust-invariants.test.ts` green |

## Ship gate checklist

1. Workspace-scoped tools + path sandbox — **yes**
2. Single trust gate on loop + MCP — **yes**
3. Consequence classes + dry-run — **yes**
4. Blast-radius cap + pins — **yes**
5. Action log SQLite + settings + replay — **yes**
6. Approval UI (approve / edit / deny / promote) — **yes** (resume path fixed in PR #10)
7. Multi-workspace switcher + file browser — **yes**
8. Automated tests — **yes**

## Manual E2E notes (2026-07-10)

Boot: `PANE_BINARY=…/Pane Dev.app/…/Pane Dev bun run dev:watch -- --new` (CDP=9699, Server=9223). Provider: DeepSeek BYOK (`deepseek-v4-flash`).

| Check | Result |
|-------|--------|
| Approval-resume unit (`chat-service` patches `approval-requested` → `approval-responded`) | **pass** |
| Trust invariants suite | **pass** |
| Workspace-scoped write via `POST /trust/replay` | **pass** (`hello.txt` written under `/tmp/pane-smoke-ws`) |
| Path escape (`filesystem_write` → `/etc/passwd`) | **pass** (tool rejects absolute/outside path after promote) |
| Bash `filesystem_bash` → `tool-approval-request` → approve resume | **pass** (`bash-out.txt` created with `smoke-bash-ok`) |
| Write approve + edit-on-approve resume | **pass** (`edit-me.txt` content `EDITED_ON_APPROVE`) |
| Action log list + Settings `#/settings/action-log` UI | **pass** (entries + Replay affordance) |
| Workspace switch (second `userWorkingDir` write) | **pass** (`/tmp/pane-smoke-ws-2/switched.txt`) |
| Workspaces UI `#/workspaces` | **pass** (grant/browse shell renders) |

## Deviations / follow-ups

1. **MCP trust pins:** Gate still uses empty pins per standalone MCP request; no `trustPins` header yet.
2. **Terminal sessions UI:** Server + tool only; no dedicated app dropdown (allowed for v1).

## BLOCKERS

None.

## Stop

Phase 2 complete for engineering ship.
