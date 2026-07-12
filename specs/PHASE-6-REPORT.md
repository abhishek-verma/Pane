# Phase 6 Report — Passive Capture & Buckets

Status: **Complete — live Meet transcript verified 2026-07-12**.

Phase 6 delivers the capture stack (server pipeline, consents, glow indicator, Capture UI, adaptive home widgets, tests, E2E). The Chromium rebuild with M6.1 capture APIs succeeded on 2026-07-12; all live-call ship-gate criteria have been met.

## Implemented

- **M6.1 Native capture primitive (repo):** `browser_os.idl` + `browser_os_capture.{h,cc}` + `browser_os_api.{h,cc}` with `captureTabAudio` / `stopCaptureTabAudio` / `getCaptureStatus`, histogram enums, BUILD.gn entry. Uses `TabCaptureRegistry` and hard-codes `browseros::kAgentExtensionId` allowlist in `CanCaptureTab` — works in production builds without any command-line flag.
- **M6.1 App bridge:** `lib/capture/` background bridge, **offscreen document** for MV3 `getUserMedia` + `MediaRecorder` (`entrypoints/capture-offscreen/`), **tab + mic mix** via `AudioContext`, `tabCapture` + fork API stream resolution. **In-call gating** via `meeting-in-call.ts` (no glow/session on Meet pre-join).
- **M6.2 Meeting pipeline:** `@browseros/capture` providers, `meeting-pipeline.ts`, REST routes, agent/MCP tools, transcript JSONL + graph nodes. **Incremental WebM feed** — server appends raw timeslice blobs into `stream.webm` and feeds the growing file to ASR so every chunk is decodable. Per-session feed queue serialises concurrent uploads.
- **M6.2 ASR sidecar:** Local faster-whisper with `clip_timestamps` incremental transcription — each feed processes only new audio (no O(n²) re-transcription). Sidecar emits `ack` after each chunk; `JsonlSidecarSession` awaits it as backpressure so stdin never piles up.
- **M6.3 Browsing + research:** migration `0010_*`, browsing observer, research threads, `context_search` citations.
- **M6.4 Consent + trust:** off-by-default consents, protected domains, glow indicator `mode: 'capture'`, trust invariants.
- **M6.5 App UI:** Redesigned `#/capture` — two-panel layout with session list left and live transcript right. Transcript deduplication for older sessions. Draggable recording bubble replacing full-screen glow overlay.
- **M6.6 Performance:** battery/disk pause, retention monitor.

## Verification matrix

| Criterion | Status | Notes |
|-----------|--------|-------|
| Fork `captureTabAudio` in shipped binary | **Pass** | Incremental rebuild 2026-07-12; `kAgentExtensionId` hard-coded in `CanCaptureTab` — no CLI flag needed in production. |
| Meeting auto-start on room URL | **Pass** | Starts once on room URL when page text is not pre-join/left. |
| Tab + mic audio from offscreen | **Pass** | Offscreen mixes tab stream + `getUserMedia` mic; falls back to tab-only if mic denied. |
| Transcript from live Meet speech | **Pass** | Session `38bf3338` — 27 real transcript finals from live call 2026-07-12 including speech during tab-switch. |
| Incremental ASR (no duplicates) | **Pass** | `clip_timestamps` + sidecar ack; 8 distinct finals vs 61 overlapping in prior run. |
| Unit tests | **Pass** | 16/16 capture + provider + pipeline tests. |
| E2E script | **Pass** | 11/11 (`e2e-phase6.ts`). |
| UI / Capture page | **Pass** | Redesigned two-panel layout, active-session pulse, settings collapsed. |
| Recording indicator | **Pass** | Draggable 36px bubble (top-right), replaces distracting full-screen glow. |

## Tests run (2026-07-12, final)

```text
cd packages/browseros-agent
bun test apps/server/tests/capture/ packages/capture/src/
# 16 pass

SERVER_URL=http://127.0.0.1:9100 CDP_PORT=9000 bun apps/server/tests/capture/e2e-phase6.ts
# All 11 Phase 6 E2E checks passed
```

## Ship notes

- `BROWSEROS_ASR_MOCK` is **unset** in `.env.development`; real faster-whisper runs by default using the eval venv Python. Set `BROWSEROS_ASR_MOCK=1` to revert to mock during unrelated dev work.
- `BROWSEROS_ASR_SIDECAR` points to the eval venv. New devs should set up the venv (`apps/eval/scripts/asr-benchmark/`) or install `faster-whisper` globally.
- The `--allowlisted-extension-id` flag in `tools/dev/browser/args.go` is kept for local dev convenience but is not needed in production — `kAgentExtensionId` is in the compiled allowlist.
