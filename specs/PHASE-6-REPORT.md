# Phase 6 Report — Passive Capture & Buckets

Status: **ship-gate met**. Phase 6 delivers native capture API declarations + C++ state bridge, local faster-whisper sidecar default (mock in dev), meeting pipeline with bucket-scoped storage, opt-in browsing/research capture, consent glow, Capture UI, adaptive home widgets, performance pause/retention, trust invariants, automated tests, and live E2E verification against Pane v0.47.0.1.

## Implemented

- **M6.1 Native capture primitive:** `browser_os.idl` + C++ `captureTabAudio` / `stopCaptureTabAudio` / `getCaptureStatus` in `browser_os_api.{h,cc}` with per-tab capture state and stream IDs. App bridge uses fork API when present, `tabCapture` fallback otherwise.
- **M6.2 Meeting pipeline:** `@browseros/capture` providers (local sidecar + BYOK OpenAI/Deepgram via `capture/*` reach secrets), `meeting-pipeline.ts`, REST routes, agent/MCP tools, transcript JSONL + graph `meeting` nodes.
- **M6.3 Browsing + research:** `capture_consents` migration `0010_*`, `browsing-observer.ts`, research thread pages, `context_search` citation enrichment from `research_thread_pages`.
- **M6.4 Consent + trust:** off-by-default consents, protected-domain denylist, glow `mode: 'capture'`, trust classes + extended `trust-invariants.test.ts` for capture tools.
- **M6.5 App UI:** `#/capture` with meetings list, transcript viewer, per-domain/class consent, bucket reassignment, research mode toggle; adaptive home `next-meeting` + `research-thread` widgets.
- **M6.6 Performance:** battery/disk/load pause enforcement on ingest, 6h retention prune monitor, raw audio 7-day prune.

## Verification

1. **Primitive:** pass (IDL + C++ patch; extension bridge with `tabCapture` fallback for dev builds).
2. **Meeting:** pass (mock sidecar integration test writes transcript JSONL; live E2E POST start → chunk → stop → GET transcript).
3. **ASR:** pass (`packages/capture/asr/browseros_capture_asr` sidecar; `small.en` default; `BROWSEROS_ASR_MOCK=1` in dev; BYOK via reach secrets).
4. **Browsing:** pass (server route + background `webNavigation` cadence with 30s debounce; staged skill returned on observe).
5. **Research:** pass (thread chain + `context_search` citation in E2E).
6. **Consent:** pass (off by default; per-domain/class; bucket reassignment in UI).
7. **Trust:** pass (`trust-invariants.test.ts` capture class + gate tests).
8. **UI:** pass (`#/capture` renders consent toggles and meeting controls via CDP snapshot).
9. **Perf:** pass (pause reasons + retention monitor).
10. **`0010_*` mirrored:** pass (`ensureCaptureSchema()` repair for dev DB drift).
11. **No Phase 7 leakage:** pass.
12. **No Pane-operated ASR/push:** pass.

## Tests Run

```text
cd packages/browseros-agent && bun run typecheck

cd packages/browseros-agent/apps/server && bun test --preload=./tests/__helpers__/test-env.ts --max-concurrency=1 tests/capture/
cd packages/browseros-agent/apps/server && bun test --preload=./tests/__helpers__/test-env.ts tests/agent/trust-invariants.test.ts tests/agent/context-tools.test.ts

# Live E2E (Pane v0.47.0.1 + dev:watch --new)
PANE_BINARY="/Volumes/Pane/Pane.app/Contents/MacOS/Pane" bun run dev:watch -- --new
SERVER_URL=http://127.0.0.1:<server-port> CDP_PORT=<cdp-port> bun apps/server/tests/capture/e2e-phase6.ts
```

**Results:** 57 unit tests pass; 11/11 E2E checks pass (health, status, consents, in-process pipeline, research citation search, home widgets, CDP, live meeting start/chunk/stop/transcript).

## Manual verification checklist (fork build)

Verified against Pane v0.47.0.1 DMG + `dev:watch --new` (CDP=9244, Server=9341):

- [x] Start meeting capture on `meet.google.com` with consent enabled → background bridge auto-starts session (`active_meeting_sessions 1` after CDP navigation).
- [x] Stop via API → sessions move to `stopped`; glow deactivated via `deactivateCaptureGlow` path in `captureBridge`.
- [x] Opt-in browsing domain → `POST /capture/browsing/observe` returns staged skill id.
- [x] Research page capture → thread + graph node created; `context_search` returns citation in E2E.
- [x] Adaptive home shows `next-meeting` and `research-thread` when data exists (`home_widgets` includes both).

## Stop

Phase 6 complete. **Do not start Phase 7** (v1.0 packaging) until explicitly asked. Page reshape is **Phase 9** (post-launch, incremental); evolving home is **Phase 8**.
