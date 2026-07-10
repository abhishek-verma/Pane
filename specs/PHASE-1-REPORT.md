# Phase 1 Completion Report — Bedrock

> Updated 2026-07-10 after M1.5 history SoT + M1.9 ASR de-risk. Prior audit: 2026-06-30.

## Ship gate (Pane v0.1) — status

| Gate criterion | Status | Evidence |
|----------------|--------|---------|
| `pane` build profile | **Pass** | `PANE_BUILD` hard-falses cloud flags |
| Sidepanel + new-tab chat (BYOK / OAuth / local) | **Pass (automated)** | Routes + provider plumbing; manual click-through still recommended |
| Pane-as-MCP wedge | **Pass (code)** | `/mcp` alias + ungated QuickSetup + shared tool spec; `claude mcp add` E2E optional |
| Chat survives a server restart | **Pass** | Server SQLite is transcript SoT; `GET /chat/history` + `GET /chat/:id`; `loadMessages` hydrates new live sessions; one-time chrome.storage migration |
| Telemetry honest + off-by-default | **Pass (code)** | Native pref-read; app/server gated |
| CDP secured to loopback + token | **Pass** | Token validation tests green |
| No Pane-server dead-end | **Pass** | Voice gateway + CLI CDN blockers resolved earlier |
| `bun run check` / tests | **Pass** | Typecheck green; history + migration tests green |

**Gate verdict:** Phase 1 **passed** for engineering ship. Remaining polish is manual click-through evidence (optional before a public v0.1 tag).

---

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M1.1 pane build profile | **Done** | |
| M1.2 disable & cleanup | **Done** | |
| M1.3 telemetry opt-in | **Done** | Network monitor optional |
| M1.4 CDP security | **Done** | Loopback + token (Unix socket deferred) |
| M1.5 session persistence | **Done** | Server SoT: slim list, full detail, import, delete, restart hydration; app history UI + migration |
| M1.6 MCP + tool spec | **Done** | |
| M1.7 process supervision | **Done** | |
| M1.8 rebrand pass | **Done** | Screenshot sweep optional |
| M1.9 ASR spike | **Done** | [`ASR-BENCHMARK.md`](./ASR-BENCHMARK.md) — **Go: local default + BYOK fast path** for M6.2 |
| M1.10 eval scaffold | **Done** | |

---

## M1.5 architecture (shipped)

- `GET /chat/history` → `{ id, lastMessagedAt, previewText }[]`
- `GET /chat/:conversationId` → full `UIMessage[]` via `SessionStore.loadMessages`
- `POST /chat/import` → idempotent migration from chrome.storage
- `DELETE /chat/:id` works for DB-only sessions
- `processMessage` hydrates from SQLite when the live Map is empty
- Sidepanel history uses TanStack Query against the server; pane builds no longer write transcripts to `local:conversations`

## M1.9 decision

See [`ASR-BENCHMARK.md`](./ASR-BENCHMARK.md). Local `faster-whisper` chunked ASR meets latency/CPU bars on Apple M3 Pro; Phase 6 ships local default with BYOK opt-in. Web Speech is rejected for this gate.

## Follow-ups (non-blocking)

- Manual UI click-through + `claude mcp add` smoke before a public tag
- Intel mid-range + 30-min real meeting fixture before Phase 6 packaging
- CDP Unix-socket transport (plan-allowed fallback already shipped)

## Stop

Phase 1 complete. Phase 4 may proceed after history SoT (merged) and this ASR decision.
