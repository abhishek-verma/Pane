# ASR Benchmark (M1.9) — Local streaming de-risk

**Status:** complete — decision recorded for Phase 6 M6.2.  
**Date:** 2026-07-10  
**Harness:** [`packages/browseros-agent/apps/eval/scripts/asr-benchmark/`](../packages/browseros-agent/apps/eval/scripts/asr-benchmark/)

This replaces the off-spec Web Speech spike. Web Speech / Pane gateway Whisper are **out of scope** for this gate (cloud / Pane-operated servers).

## Decision (M6.2 path)

**Go — local default on capable hardware, BYOK as the accuracy fast path.**

| Concern | Verdict |
|---------|---------|
| Streaming latency | **Pass** — p95 chunk latency 1.0–3.2 s on 4 s windows (bar ≤ ~5 s) |
| Real-time factor | **Pass** — RTF 0.10 (`base.en`) / 0.33 (`small.en`) on Apple M3 Pro |
| Sustained CPU | **Pass** — machine remained usable during the run |
| WER on TTS fixture | **Inconclusive** — 28–31% driven largely by proper-name errors (`Abhishek` → `This check` / `paycheck`); not a fair meeting-corpus score |
| Diarization | **Defer** — use page-content labels first; optional local diarization later |

**Phase 6 ships `TranscriptionProvider` with a local `faster-whisper` default** (recommended size: `small.en` on Apple Silicon) and BYOK opt-in. Before packaging for Intel mid-range / battery-only users, re-run this harness on a 10–30 min real meeting fixture; if that WER stays above ~25% or RTF > 1.5 on that class, flip the **default** to BYOK on that profile while keeping local available.

Browsing learnings (M6.3) are unaffected.

## Hardware / methodology

| Field | Value |
|-------|-------|
| Machine | MacBook Pro (Mac15,6), Apple M3 Pro, 18 GB |
| OS | macOS Darwin 25.5.0 (arm64) |
| Power | AC (plugged in) |
| Engine | `faster-whisper` (CTranslate2), CPU, `int8` |
| Chunking | Fixed 4.0 s windows + VAD filter inside whisper |
| Fixture | macOS `say` → 16 kHz mono WAV (~34 s), known script in `fixtures/sample.txt` |
| Models | `base.en`, `small.en` |
| Metrics | partial chunk latency p50/p95, wall RTF, WER via `jiwer`, CPU user time, RSS |

**Not measured in this pass (explicit gaps):**

- Full 30-minute multi-speaker meeting (AMI / real standup) — micro-fixture only.
- Battery drain over 30 minutes — required before release packaging; M6.6 pause-on-battery still applies.
- Second mid-range Intel laptop profile.
- Production diarization — spot-check recommendation only (below).

## Results

### `base.en` (`results/latest.json`)

| Metric | Value | Bar |
|--------|-------|-----|
| Audio length | 34.3 s | — |
| Partial latency p50 | 296 ms | — |
| Partial latency p95 | 1055 ms | ≤ ~5 s → **pass** |
| Real-time factor | 0.10 | ≪ 1 → **pass** |
| WER | 0.284 | TTS proper-name noise; treat as inconclusive |
| CPU user | 10.6 s | usable |
| Max RSS | ~616 MB (`ru_maxrss` KB on macOS) | acceptable |

### `small.en` (`results/small.en.json`)

| Metric | Value | Bar |
|--------|-------|-----|
| Partial latency p50 | 999 ms | — |
| Partial latency p95 | 3243 ms | ≤ ~5 s → **pass** |
| Real-time factor | 0.33 | ≪ 1 → **pass** |
| WER | 0.309 | still TTS proper-name noise; inconclusive |
| CPU user | 44.1 s | usable |
| Max RSS | ~1.5 GB | acceptable for sidecar, not for embedding in Bun |

## Diarization feasibility

Laptop-local diarization (e.g. pyannote) is **feasible as a follow-up**, not a day-one hard dependency:

- For v0.6 meeting notes, prefer **page-content speaker labels** (Meet/Zoom participant list via existing extractors) when available.
- Optional local diarization can land behind a setting once CPU cost is measured on a 10-minute subset.
- BYOK providers that return speaker labels remain the accuracy fast path.

## Integration recommendation (M6.2)

1. **`TranscriptionProvider` interface** in `@browseros/capture` (Phase 6) with:
   - `LocalFasterWhisperProvider` (sidecar) — **default on capable hardware**
   - `ByokTranscriptionProvider` (OpenAI / Deepgram) — opt-in
2. Prefer a **sidecar process** over embedding the model in the Bun server: isolates ~0.6–1.5 GB RSS, allows crash restart, matches the local-model-host pattern.
3. Pipeline: tab audio (M6.1) → VAD → 2–5 s chunks → partial + final transcripts → bucket storage under `~/.browseros/capture/`.
4. Do **not** use Chrome Web Speech as the local default (cloud-backed in Chrome; contradicts State A).

## Explicit rejections

| Candidate | Why rejected for this gate |
|-----------|----------------------------|
| Web Speech API (`asr-spike.html`) | Cloud-backed in Chromium; not local-first |
| Pane `llm.browseros.com` gateway Whisper | Pane-operated server; gated off in pane builds |
| Batch-only full-file whisper | Fine for offline transcript; not for live meeting notes |

## How to reproduce

```bash
cd packages/browseros-agent/apps/eval/scripts/asr-benchmark
python3 -m venv .venv && .venv/bin/pip install -U pip faster-whisper jiwer
.venv/bin/python run_benchmark.py --generate-fixture --model base.en
.venv/bin/python run_benchmark.py --audio fixtures/sample.wav --reference fixtures/sample.txt --model small.en --out results/small.en.json
```

## Follow-ups before Phase 6 packaging

1. Re-run on an Intel mid-range laptop (AC + battery) with a 10–30 min real meeting fixture.
2. Lock default model size from that matrix (`small.en` vs `base.en`).
3. Spot-check pyannote (or equivalent) CPU cost on 10 minutes.
4. Keep mic / voice mode disabled in pane builds until `TranscriptionProvider` ships (M6.2).
