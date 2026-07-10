# ASR benchmark harness (M1.9)

Standalone faster-whisper chunked transcription benchmark. **Not product code.**

## Setup

```bash
cd packages/browseros-agent/apps/eval/scripts/asr-benchmark
python3 -m venv .venv
.venv/bin/pip install -U pip faster-whisper jiwer
```

## Run

```bash
# Generates a short macOS `say` fixture, then benchmarks chunked transcription
.venv/bin/python run_benchmark.py --generate-fixture

# Or point at your own 16 kHz mono WAV + reference transcript
.venv/bin/python run_benchmark.py --audio /path/to/meeting.wav --reference /path/to/ref.txt --model base.en
```

Results land in `results/latest.json`. Copy numbers into `specs/ASR-BENCHMARK.md`.

## Notes

- Default fixture is ~45s of spoken English (enough for a micro-benchmark). For the full M1.9 bar, swap in a 30-minute meeting recording with a reference transcript (AMI / internal standup).
- Diarization is intentionally out of this script; see the report for a spot-check recommendation.
- Web Speech API (`apps/eval/src/asr-spike.html`) is **not** a valid M1.9 gate input.
