# Phase 5 Report — Proactive & Reach

Status: **ship gate met** — M5.1–M5.7 complete. Phase 6 not started.

## Scheduler split (app vs server)

| Path | Owner | Role |
|------|-------|------|
| `apps/app` `chrome.alarms` + `scheduledJobRuns.ts` | Extension | In-browser wall-clock scheduler; POSTs `/chat` with `isScheduledTask: true` |
| `apps/server/src/scheduler/` | Server | Graph-event triggers, daily digest monitor, keep-alive runs, approval wait, home data |
| `scheduled_runs` (SQLite `0009`) | Server SoT | Keep-alive / trigger / digest-driven run records + `completedSteps` idempotency |
| `local:scheduledJobRuns` | App UI | Remains for Scheduled Tasks list; best-effort sync of `idempotencyKey` / `completedSteps` |

Do **not** delete app alarms — both paths share the same agent loop + trust gate.

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M5.1 Trigger engine | **done** | `onGraphEvent` after ingest; rule DSL: `toolName` / `occurrenceN` / `payloadContains` + cooldown (default 5 min); Triggers tab on Scheduled Tasks; `GET/POST /scheduler/triggers` |
| M5.2 Daily digest | **done** | Template assembler → `memories/digests/daily-YYYY-MM-DD.md` + `latest-daily.md`; sibling to curation stubs; `POST /scheduler/digest/run`; monitor from `Application.initCoreServices`; pause on battery / quiet hours |
| M5.3 macOS keep-alive | **done** | LaunchAgent `com.browseros.agent-server`; Settings toggle with honest limitations; Windows/Linux return `implemented: false` (no fake success) |
| M5.4 Reach transports | **done** | `apps/server/src/reach/` behind `ReachTransport`; OS push queue, SMTP, Telegram long-poll; secrets in `reach_secrets` SQLite (OAuth-token pattern); `#/settings/reach` |
| M5.5 Approval-over-channel | **done** | `GateContext.unattended` for scheduled tasks; channel wait never auto-approves; approve/deny tokens; timeout → skip; inbound `/approve` `/deny` + email `APPROVE`/`DENY` |
| M5.6 Idempotency | **done** | Server `scheduled_runs.completed_steps_json` + `stepFingerprint`; app run model extended; stale timeout **keeps** `completedSteps` |
| M5.7 Adaptive home | **done** | Widgets on `AgentCommandHome` via `/scheduler/home`; digest from file; pin/hide/dismiss → `USER.md`; day-1 recent-sites fallback; no LLM at tab-open; capture/reshape widgets omitted |

## Migration `0009_curvy_bucky`

Tables: `trigger_rules`, `pending_approvals`, `reach_secrets`, `scheduled_runs`. Mirrored in `client.ts` `currentMigrationHistory` + `currentSchemaStatements`.

## Reach defaults

- Quiet hours: **22:00–08:00** local (configurable via `PATCH /reach/quiet-hours`)
- Rate limit: **20 messages/day** per transport
- Approval timeout: **45 minutes**
- Secrets: SQLite `reach_secrets` (local DB, same as `oauth_tokens`) — not OS keychain in v0.5
- OS push primary for interactive: app drains `/reach/os-push/queue` → `chrome.notifications`; server-only queues until attach
- Email inbound: outbound SMTP shipped; IMAP reply parsing deferred — Telegram inbound covers approve/deny
- Telegram: pairing code `/pair <code>`; unknown chat ids rejected

## Keep-alive binary paths

| Mode | ProgramArguments |
|------|------------------|
| Dev | `process.execPath` (bun) + `apps/server/src/index.ts` + `--server-only` |
| Release | Packaged `browseros-server` next to the app — **TODO** finalize path in release packaging |

Honest UI copy: closed laptop / powered-off machine does not run; browser-tool jobs need a browser (`browserMissingSkipReason()`).

## Independent verification

1. **Trigger:** matching `GraphEvent` → executor called with prompt; non-match → no call; cooldown suppresses duplicate (`tests/scheduler/trigger-engine.test.ts`).
2. **Digest:** `daily-*.md` written with graph/memory/task content; home reads file; template marked `no LLM` (`digest.test.ts`, `approvals-home-idempotency.test.ts`).
3. **Keep-alive:** plist has `ProgramArguments` / `KeepAlive` / `RunAtLoad`; install/uninstall round-trip (`keep-alive.test.ts`).
4. **Reach:** three transports behind one interface; secrets in SQLite; unknown Telegram sender rejected; quiet hours suppress (`reach.test.ts`).
5. **Approval-over-channel:** approve resumes; deny cancels; timeout skips; approve token cannot deny (`approvals-home-idempotency.test.ts`). Channel outcome map — never sets `__promoted` on loop schema.
6. **Idempotency:** fingerprint equality ignores `__promoted`; completed consequential steps skipped on same key.
7. **Adaptive home:** digest widget from file; day-1 fallback always; dismiss → `USER.md` pref line; ranking + hysteresis unit tests in app `HomeEngine.test.ts`.
8. **Trust invariants** green (`trust-invariants.test.ts` — no `__promoted` on loop schema).
9. **`0009_*` mirrored** in `client.ts`.
10. **No Phase 6/7 leakage** — no ASR, no page reshape engine; meeting/research widgets omitted.
11. **No Pane cloud push / cloud-headless.**

## Tests run (automated)

```text
cd packages/browseros-agent && bun run check   # exit 0

cd apps/server && bun test --preload=./tests/__helpers__/test-env.ts --max-concurrency=1 \
  tests/scheduler/ tests/agent/trust-invariants.test.ts
# 63 pass

cd apps/app && bun test
# includes HomeEngine.test.ts
```

Pre-existing (not Phase 5): `test:api` Klavis module gaps; fallow unused-deps / memory files↔store cycle.

## Commits (this phase)

- `feat(server): graph-event trigger engine (M5.1)`
- `feat: Phase 5 proactive reach — digest, keep-alive, channels, home` (M5.2–M5.7)

## Deviations / limitations

1. Trigger/digest runs enqueue a `scheduled_runs` row; full agent execution for keep-alive still goes through `/chat` (same loop) — executor does not spawn a second runtime.
2. Email IMAP inbound not shipped; Telegram + deep-link cover channel approve/deny.
3. Release keep-alive binary path documented as TODO; Dev path works.
4. Digest is template-only (LLM polish optional / not required for ship gate).
5. App ↔ server run-store sync is best-effort; server SQLite is SoT for keep-alive/trigger idempotency.

## BLOCKERS

None for ship gate.

## Stop

Phase 5 complete. **Do not start Phase 6** (passive capture) until explicitly asked.
