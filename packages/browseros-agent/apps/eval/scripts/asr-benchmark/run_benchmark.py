#!/usr/bin/env python3
"""
M1.9 ASR de-risk harness (not product code).

Chunked faster-whisper transcription over a meeting-style fixture.
Measures partial-chunk latency, final WER, CPU, and wall time.

Usage:
  python run_benchmark.py --audio fixtures/sample.wav --reference fixtures/sample.txt
  python run_benchmark.py --generate-fixture   # macOS `say` + afconvert
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import resource
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
RESULTS = ROOT / "results"

# Meeting-style script (~45s spoken). Enough for a credible micro-benchmark;
# scale to 30 min by concatenating or swapping in AMI/LibriSpeech fixtures.
DEFAULT_SCRIPT = """
Good morning everyone. Let's start with the deploy status.
The staging rollout finished last night without errors.
Abhishek will own the follow-up on the context graph latency budget.
We still need to decide whether local transcription is good enough for meeting notes.
If the laptop stays usable under load, we ship a local default.
Otherwise meeting capture stays bring-your-own-key only.
Action items: publish the benchmark report, wire chat history to the server, and do not start phase four until history is durable.
Any questions before we move on?
""".strip()


@dataclass
class BenchmarkResult:
    hardware: str
    os: str
    model: str
    device: str
    compute_type: str
    audio_seconds: float
    chunk_seconds: float
    num_chunks: int
    partial_latency_p50_ms: float
    partial_latency_p95_ms: float
    wall_seconds: float
    rtf: float
    wer: float
    cpu_user_seconds: float
    max_rss_mb: float
    hypothesis: str
    reference: str
    go_no_go_hint: str


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return ordered[idx]


def generate_fixture(out_wav: Path, out_txt: Path) -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    aiff = FIXTURES / "sample.aiff"
    out_txt.write_text(DEFAULT_SCRIPT + "\n", encoding="utf-8")
    subprocess.run(
        ["say", "-o", str(aiff), DEFAULT_SCRIPT],
        check=True,
    )
    subprocess.run(
        [
            "afconvert",
            "-f",
            "WAVE",
            "-d",
            "LEI16@16000",
            "-c",
            "1",
            str(aiff),
            str(out_wav),
        ],
        check=True,
    )
    aiff.unlink(missing_ok=True)


def load_audio_mono_16k(path: Path):
    import numpy as np
    import wave

    with wave.open(str(path), "rb") as wf:
        rate = wf.getframerate()
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())
    if width != 2:
        raise SystemExit(f"expected 16-bit PCM, got sample width {width}")
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != 16000:
        # Simple linear resample for fixture audio.
        duration = len(audio) / rate
        target = int(duration * 16000)
        x_old = np.linspace(0, 1, num=len(audio), endpoint=False)
        x_new = np.linspace(0, 1, num=target, endpoint=False)
        audio = np.interp(x_new, x_old, audio).astype(np.float32)
        rate = 16000
    return audio, rate


def run_benchmark(
    audio_path: Path,
    reference_path: Path,
    model_size: str,
    chunk_seconds: float,
) -> BenchmarkResult:
    from faster_whisper import WhisperModel
    from jiwer import wer as compute_wer

    audio, rate = load_audio_mono_16k(audio_path)
    reference = reference_path.read_text(encoding="utf-8").strip()
    chunk_samples = int(chunk_seconds * rate)
    chunks = [
        audio[i : i + chunk_samples]
        for i in range(0, len(audio), chunk_samples)
        if len(audio[i : i + chunk_samples]) > rate * 0.25
    ]

    device = "cpu"
    compute_type = "int8"
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    latencies_ms: list[float] = []
    hypotheses: list[str] = []
    t0 = time.perf_counter()
    ru0 = resource.getrusage(resource.RUSAGE_SELF)

    for chunk in chunks:
        started = time.perf_counter()
        segments, _info = model.transcribe(
            chunk,
            language="en",
            beam_size=1,
            vad_filter=True,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        latencies_ms.append((time.perf_counter() - started) * 1000)
        if text:
            hypotheses.append(text)

    wall = time.perf_counter() - t0
    ru1 = resource.getrusage(resource.RUSAGE_SELF)
    hypothesis = " ".join(hypotheses).strip()
    score = float(compute_wer(reference.lower(), hypothesis.lower())) if hypothesis else 1.0
    audio_seconds = len(audio) / rate
    p50 = percentile(latencies_ms, 50)
    p95 = percentile(latencies_ms, 95)
    rtf = wall / audio_seconds if audio_seconds else 0.0

    # Go hint for this micro-run (full 30-min bar is documented in ASR-BENCHMARK.md).
    if p95 <= 5000 and score <= 0.20 and rtf < 1.2:
        hint = "lean-go"
    elif score > 0.25 or p95 > 8000 or rtf > 2.0:
        hint = "lean-no-go"
    else:
        hint = "borderline"

    return BenchmarkResult(
        hardware=platform.processor() or platform.machine(),
        os=f"{platform.system()} {platform.release()}",
        model=model_size,
        device=device,
        compute_type=compute_type,
        audio_seconds=audio_seconds,
        chunk_seconds=chunk_seconds,
        num_chunks=len(chunks),
        partial_latency_p50_ms=p50,
        partial_latency_p95_ms=p95,
        wall_seconds=wall,
        rtf=rtf,
        wer=score,
        cpu_user_seconds=(ru1.ru_utime - ru0.ru_utime),
        max_rss_mb=ru1.ru_maxrss / (1024 * 1024)
        if platform.system() == "Linux"
        else ru1.ru_maxrss / 1024,
        hypothesis=hypothesis,
        reference=reference,
        go_no_go_hint=hint,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-fixture", action="store_true")
    parser.add_argument("--audio", type=Path, default=FIXTURES / "sample.wav")
    parser.add_argument("--reference", type=Path, default=FIXTURES / "sample.txt")
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--chunk-seconds", type=float, default=4.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=RESULTS / "latest.json",
    )
    args = parser.parse_args()

    RESULTS.mkdir(parents=True, exist_ok=True)
    if args.generate_fixture or not args.audio.exists():
        print("Generating macOS say/afconvert fixture…", file=sys.stderr)
        generate_fixture(args.audio, args.reference)

    result = run_benchmark(
        args.audio,
        args.reference,
        model_size=args.model,
        chunk_seconds=args.chunk_seconds,
    )
    payload = asdict(result)
    args.out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    print(f"\nWrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
