#!/usr/bin/env python3
"""
Local faster-whisper sidecar for Pane meeting capture (M1.9 default path).

Reads newline-delimited JSON audio chunks on stdin; emits partial/final
transcript segments as JSON lines on stdout.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path


def emit(segment: dict) -> None:
    sys.stdout.write(json.dumps(segment) + "\n")
    sys.stdout.flush()


def emit_ack(sequence: int) -> None:
    emit({"kind": "ack", "sequence": sequence})


def mock_transcribe(chunk: dict) -> None:
    seq = chunk.get("sequence", 0)
    session_id = chunk.get("sessionId", "unknown")
    captured_at = chunk.get("capturedAt", int(time.time() * 1000))
    text = f"[chunk {seq}] meeting audio received"
    emit(
        {
            "id": str(uuid.uuid4()),
            "sessionId": session_id,
            "kind": "partial",
            "text": text,
            "startedAtMs": captured_at,
            "endedAtMs": captured_at + 1000,
            "capturedAt": captured_at,
        }
    )
    emit(
        {
            "id": str(uuid.uuid4()),
            "sessionId": session_id,
            "kind": "final",
            "text": text,
            "startedAtMs": captured_at,
            "endedAtMs": captured_at + 4000,
            "capturedAt": captured_at + 4000,
        }
    )
    emit_ack(seq)


# Process state for one capture session (one sidecar process per session).
_LAST_TRANSCRIBED_END_S = 0.0
_CLIP_PAD_S = 0.15


def audio_duration_s(path: str) -> float:
    import av

    with av.open(path) as container:
        if container.duration is not None:
            return float(container.duration) / 1_000_000
        total = 0.0
        for frame in container.decode(audio=0):
            if frame.time is not None:
                total = max(total, float(frame.time) + float(frame.samples) / float(frame.rate))
        return total


def whisper_transcribe(chunk: dict, model_name: str, device: str) -> None:
    global _LAST_TRANSCRIBED_END_S
    from faster_whisper import WhisperModel

    sequence = int(chunk.get("sequence", 0))

    # Lazy-init model once per process.
    if not hasattr(whisper_transcribe, "_model"):
        whisper_transcribe._model = WhisperModel(  # type: ignore[attr-defined]
            model_name,
            device=device,
            compute_type="int8" if device == "cpu" else "default",
        )
    model = whisper_transcribe._model  # type: ignore[attr-defined]

    session_id = chunk.get("sessionId", "unknown")
    captured_at = chunk.get("capturedAt", int(time.time() * 1000))
    raw = base64.b64decode(chunk["dataBase64"])

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        duration_s = audio_duration_s(tmp_path)
        clip_start = max(0.0, _LAST_TRANSCRIBED_END_S - _CLIP_PAD_S)
        if duration_s <= clip_start + 0.05:
            emit_ack(sequence)
            return

        segments, _info = model.transcribe(
            tmp_path,
            vad_filter=True,
            clip_timestamps=f"{clip_start},{duration_s}",
            condition_on_previous_text=False,
        )
        parts = [segment.text.strip() for segment in segments if segment.text.strip()]
        final_text = " ".join(parts).strip()
        if final_text:
            emit(
                {
                    "id": str(uuid.uuid4()),
                    "sessionId": session_id,
                    "kind": "final",
                    "text": final_text,
                    "capturedAt": captured_at,
                }
            )

        _LAST_TRANSCRIBED_END_S = duration_s
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        emit_ack(sequence)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.environ.get("BROWSEROS_ASR_MODEL", "small.en"))
    parser.add_argument("--device", default=os.environ.get("BROWSEROS_ASR_DEVICE", "auto"))
    parser.add_argument(
        "--mock",
        action="store_true",
        default=os.environ.get("BROWSEROS_ASR_MOCK", "") == "1",
    )
    args = parser.parse_args()

    use_whisper = not args.mock
    if use_whisper:
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            sys.stderr.write(
                "browseros_capture_asr: faster-whisper not installed; "
                "pip install faster-whisper or set BROWSEROS_ASR_MOCK=1\n"
            )
            sys.exit(1)

    device = args.device
    if device == "auto":
        device = "cpu"

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        chunk = json.loads(line)
        if use_whisper:
            whisper_transcribe(chunk, args.model, device)
        else:
            mock_transcribe(chunk)


if __name__ == "__main__":
    main()
