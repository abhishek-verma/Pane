# Phase 5 Report — Proactive & Reach

Status: **ship gate met** (after ship-blocker fix) — M5.1–M5.7 complete. Phase 6 not started.

## Scheduler split (app vs server)

| Path | Owner | Role |
|------|-------|------|
| `apps/app` `chrome.alarms` + `scheduledJobRuns.ts` | Extension | In-browser wall-clock scheduler; POSTs `/chat` with `isScheduledTask: true` |
| `apps/app` `drainServerRuns.ts` | Extension | Polls `GET /scheduler/runs?status=pending` → claim → `/chat` (with `scheduledRunId` + `idempotencyKey`) → complete |
| `apps/app` `drainOsPush.ts` | Extension | Polls `GET /reach/os-push/queue` → `chrome.notifications` |
| `apps/server/src/scheduler/` | Server | Graph-event triggers, daily digest monitor, keep-alive LaunchAgent, approval wait, home data |
| `scheduled_runs` (SQLite `0009`) | Server SoT | Keep-alive / trigger / digest-driven run records + `completedSteps` idempotency |
| `local:scheduledJobRuns` | App UI | Remains for Scheduled Tasks list; best-effort sync of `idempotencyKey` / `completedSteps` |

Do **not** delete app alarms — both paths share the same agent loop + trust gate.

**Execution model:** Triggers and keep-alive enqueue `pending` rows (and OS-push a nudge). LLM execution starts when the extension is up and drains via `/chat`. Providers stay in the extension; keep-alive alone does not run the agent loop.

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M5.1 Trigger engine | **done** | `onGraphEvent` after ingest; rule DSL + cooldown; Triggers tab; enqueue + OS-push nudge; app drain executes |
| M5.2 Daily digest | **done** | Template assembler → digest files; `POST /scheduler/digest/run`; pause on battery / quiet hours |
| M5.3 macOS keep-alive | **done** | LaunchAgent with `--server-only` + `--server-port`; HTTP without CDP; Windows/Linux `implemented: false` |
| M5.4 Reach transports | **done** | `apps/server/src/reach/` behind `ReachTransport`; OS push queue drained by app; SMTP; Telegram long-poll |
| M5.5 Approval-over-channel | **done** | `GateContext.unattended` for scheduled tasks; channel wait never auto-approves |
| M5.6 Idempotency | **done** | Trust gate skip/append via `scheduledRunId` + run `idempotencyKey` in `stepFingerprint`; fingerprint ignores `__promoted` |
| M5.7 Adaptive home | **done** | Widgets via `/scheduler/home`; pin/hide/dismiss → `USER.md`; day-1 recent-sites fallback |

## Migration `0009_curvy_bucky`

Tables: `trigger_rules`, `pending_approvals`, `reach_secrets`, `scheduled_runs`. Mirrored in `client.ts` `currentMigrationHistory` + `currentSchemaStatements`.

## Reach defaults

- Quiet hours: **22:00–08:00** local (configurable via `PATCH /reach/quiet-hours`)
- Rate limit: **20 messages/day** per transport
- Approval timeout: **45 minutes**
- Secrets: SQLite `reach_secrets` (local DB, same as `oauth_tokens`) — not OS keychain in v0.5
- OS push: server queues; app drains `/reach/os-push/queue` → `chrome.notifications` (manifest `notifications` permission)
- Email inbound: outbound SMTP shipped; IMAP reply parsing deferred — Telegram inbound covers approve/deny
- Telegram: pairing code `/pair <code>`; unknown chat ids rejected

## Keep-alive (`--server-only`)

| Mode | ProgramArguments |
|------|------------------|
| Dev | `process.execPath` (bun) + `apps/server/src/index.ts` + `--server-only` + `--server-port <default>` |
| Release | Packaged `browseros-server` next to the app — **TODO** finalize path in release packaging |

When `serverOnly` and no `--cdp-port`, `main.ts` skips CDP and uses an unavailable-browser stub. HTTP, digest, reach, and run enqueue still work. CDP attach happens when the full browser launches later. Browser-tool jobs need a browser (`browserMissingSkipReason()`).

Honest UI copy: closed laptop / powered-off machine does not run.

## Pending runs API

- `GET /scheduler/runs?status=pending`
- `POST /scheduler/runs/:id/claim` (pending → running)
- `POST /scheduler/runs/:id/complete` `{ status, error? }`

## Independent verification

1. **Trigger:** matching `GraphEvent` → enqueue + OS-push; app drain → claim → `/chat` → complete.
2. **Digest:** `daily-*.md` written; home reads file; template marked `no LLM`.
3. **Keep-alive:** plist contains `--server-only` and `--server-port`; install/uninstall round-trip; config parses `--server-only`.
4. **Reach:** three transports; app drains OS-push queue to notifications.
5. **Approval-over-channel:** approve resumes; deny cancels; timeout skips; never auto-approve.
6. **Idempotency:** gate skips completed consequential steps; fingerprint uses run `idempotencyKey`; ignores `__promoted`.
7. **Adaptive home:** digest widget from file; day-1 fallback; dismiss → `USER.md`.
8. **Trust invariants** green (`trust-invariants.test.ts`).
9. **`0009_*` mirrored** in `client.ts`.
10. **No Phase 6/7 leakage.**
11. **No Pane cloud push / cloud-headless.**

## Tests run (automated)

```text
cd packages/browseros-agent/apps/server && bun test --preload=./tests/__helpers__/test-env.ts --max-concurrency=1 \
  tests/scheduler/ tests/agent/trust-invariants.test.ts

cd packages/browseros-agent/apps/app && bun test \
  lib/schedules/drainPendingRuns.test.ts \
  lib/schedules/drainOsPushQueue.test.ts
```

## Commits (this phase)

- `feat(server): graph-event trigger engine (M5.1)`
- `feat: Phase 5 proactive reach — digest, keep-alive, channels, home` (M5.2–M5.7)
- `fix: Phase 5 ship-gate blockers — server-only, run drain, gate idempotency, OS push`

## Deviations / limitations

1. Trigger/keep-alive runs enqueue on the server; **app drain** drives `/chat` (providers in extension). No server-side LLM provider store in v0.5.
2. Email IMAP inbound not shipped; Telegram + deep-link cover channel approve/deny.
3. Release keep-alive binary path documented as TODO; Dev path works.
4. Digest is template-only (LLM polish optional / not required for ship gate).
5. App ↔ server run-store sync is best-effort; server SQLite is SoT for keep-alive/trigger idempotency.
6. Keep-alive without CDP cannot run browser tools until a full browser session attaches.

## BLOCKERS

None for ship gate (resolved: `--server-only` boot, pending-run drain, runtime gate idempotency, OS-push → notifications).

## Stop

Phase 5 complete. **Do not start Phase 6** (passive capture) until explicitly asked.
