# BrowserOS Agent Extension

## v0.0.158 (2026-08-07)

## What's Changed

- chore(release): bump versions for v0.47.0.63
- fix: improve Voice onboarding step UX
- feat: add Voice onboarding step for Whisper model download
- feat: voice dictation via local Whisper ASR
- refactor: remove PANE_BUILD flag and BrowserOS-specific code
- docs: clarify server workflow is not used; fix PANE_BUILD comment in wxt.config


## v0.0.102 (2026-07-12)

## What's Changed

### Phase 7 — Pane v1.0 Polish, Correctness & Launch Readiness

- **Diagnostics**: new `#/settings/diagnostics` route with server health, CDP status, disk usage, capture consent summary, reach transport status, keep-alive status, 7-day action log summary, and self-service tools (wipe context index, reset onboarding, inline log viewer)
- **Cross-platform keep-alive**: Windows Task Scheduler implementation (`PaneAgentServer`) and Linux systemd user unit (`pane-agent-server.service`)
- **LaunchAgent renamed**: `com.browseros.agent-server` → `com.pane.agent-server`; logs moved to `~/Library/Logs/Pane/`
- **Log rotation**: server now writes to dated `pane-server-YYYY-MM-DD.log` files with 7-day retention
- **Pane-thesis eval**: multi-step scenario proving browse + workspace write + context recall + memory + trust audit in one flow
- **UX polish**: improved empty states across Tasks, Memory, ActionLog, AdaptiveHomeWidgets, ScheduledTaskResults; SMTP inputs now have placeholder text; ShortcutsDialog placeholder removed
- **CI matrix expanded**: added `server-memory`, `server-capture`, `server-scheduler`, `trust-invariants`, `cli` suites; removed BrowserOS-only claw suites
- **JTBD popup removed**: dead BrowserOS survey module deleted
- **INSTALL.md**: comprehensive install, update, and keep-alive guide for macOS, Windows, and Linux

### Phase 6 — Passive Capture & Buckets (included in this release)

- Native Chromium tab audio capture (`captureTabAudio` / `stopCaptureTabAudio` / `getCaptureStatus`)
- Offscreen MV3 audio mix via dedicated capture-offscreen entrypoint
- faster-whisper ASR sidecar with incremental transcription and backpressure
- Meeting pipeline (JSONL transcripts, graph nodes, meeting bucket)
- Browsing learnings observer and research threads
- Consent model (off-by-default, domain-level)
- Draggable recording bubble
- `#/capture` two-panel UI (session list + live transcript)


## v0.0.101 (2026-07-11)

## What's Changed

- chore(agent-extension): bump version to 0.0.101 for CRX signing fix release
- docs: add agent extension changelog for v0.0.100


## v0.0.100 (2026-07-10)

Initial release

## v0.0.99 (2026-04-08)

## What's Changed

- chore: bump server and extension version (#659)
- chore(agent): remove workflows feature (#656)
- feat: replace model picker with shadcn Combobox + fuse.js fuzzy search (#617)
- feat: clean-up - remove obsolete controller extension (#610)
- docs: update agent extension changelog for v0.0.98 (#609)


## v0.0.98 (2026-03-27)

## What's Changed

- chore: update agent version (#608)
- chore: fix version number for extension (#606)
- fix: improve chat history freshness and reduce query payload (#598)
- feat: isolate new-tab agent navigation from origin tab (#593)
- docs: overhaul READMEs across all major packages (#594)
- fix(ui): resolve MCP promo banner dismiss button overlapping with text (#581)
- docs: update agent extension changelog for v0.0.52 (#573)


## v0.0.52 (2026-03-26)

Initial release

