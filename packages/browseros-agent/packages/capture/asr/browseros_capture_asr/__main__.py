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


def whisper_transcribe(chunk: dict, model_name: str, device: str) -> None:
    from faster_whisper import WhisperModel

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
        segments, _info = model.transcribe(tmp_path, vad_filter=True)
        text_parts: list[str] = []
        for segment in segments:
            text_parts.append(segment.text.strip())
            emit(
                {
                    "id": str(uuid.uuid4()),
                    "sessionId": session_id,
                    "kind": "partial",
                    "text": segment.text.strip(),
                    "startedAtMs": int(segment.start * 1000),
                    "endedAtMs": int(segment.end * 1000),
                    "capturedAt": captured_at,
                }
            )
        final_text = " ".join(part for part in text_parts if part)
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
    finally:
        Path(tmp_path).unlink(missing_ok=True)


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
            use_whisper = False

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
