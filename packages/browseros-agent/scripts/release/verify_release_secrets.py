#!/usr/bin/env python3
"""Verify Pane release secrets match the keys baked into the repo.

Run locally before uploading secrets to GitHub:

  export SPARKLE_PRIVATE_KEY='...'
  export AGENT_EXTENSION_PRIVATE_KEY="$(cat agent.pem)"
  export CLAW_EXTENSION_PRIVATE_KEY="$(cat claw.pem)"   # optional

  python3 packages/browseros-agent/scripts/release/verify_release_secrets.py

Exit 0 when every *set* secret validates. Unset optional secrets are reported as skipped.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PUBLIC_JSON = SCRIPT_DIR / "pane-release-keys.public.json"


def load_expected_keys() -> dict:
    if not PUBLIC_JSON.exists():
        raise SystemExit(
            f"Missing {PUBLIC_JSON}. Run generate-pane-release-keys.py first."
        )
    return json.loads(PUBLIC_JSON.read_text())


def _ok(message: str) -> None:
    print(f"  OK  {message}")


def _fail(message: str) -> None:
    print(f"  FAIL  {message}", file=sys.stderr)


def _skip(message: str) -> None:
    print(f"  SKIP  {message}")


def verify_sparkle_private_key(key_data: str, expected: dict) -> bool:
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    except ImportError:
        _fail("cryptography not installed (pip install cryptography)")
        return False

    key_data = key_data.strip()
    try:
        try:
            key_bytes = base64.b64decode(key_data)
        except Exception:
            key_bytes = key_data.encode("latin-1")

        if len(key_bytes) == 64:
            private_key = Ed25519PrivateKey.from_private_bytes(key_bytes[:32])
        elif len(key_bytes) == 32:
            private_key = Ed25519PrivateKey.from_private_bytes(key_bytes)
        else:
            _fail(
                f"SPARKLE_PRIVATE_KEY: expected 32 or 64 raw bytes after base64 decode "
                f"(got {len(key_bytes)}). Run generate-pane-release-keys.py."
            )
            return False

        public_raw = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        public_b64 = base64.b64encode(public_raw).decode("ascii")
        if public_b64 != expected["sparkle"]["publicKeyBase64"]:
            _fail(
                "SPARKLE_PRIVATE_KEY does not match pane-release-keys.public.json "
                f"(expected {expected['sparkle']['publicKeyBase64']}, got {public_b64})"
            )
            return False

        _ok(
            "SPARKLE_PRIVATE_KEY matches embedded SUPublicEDKey "
            "(browser + server + WinSparkle feeds)"
        )
        return True
    except Exception as exc:
        _fail(f"SPARKLE_PRIVATE_KEY: {exc}")
        return False


def _public_key_base64_from_pem(pem: str) -> str:
    pem = pem.strip()
    if "BEGIN" not in pem:
        raise ValueError("expected PEM with -----BEGIN PRIVATE KEY----- or RSA PRIVATE KEY")

    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as handle:
        handle.write(pem if pem.endswith("\n") else f"{pem}\n")
        pem_path = handle.name

    try:
        result = subprocess.run(
            ["openssl", "rsa", "-in", pem_path, "-pubout", "-outform", "DER"],
            check=True,
            capture_output=True,
        )
        return base64.b64encode(result.stdout).decode("ascii")
    finally:
        Path(pem_path).unlink(missing_ok=True)


def verify_extension_private_key(name: str, pem: str, expected_manifest_key: str) -> bool:
    pem = pem.strip()
    if not pem:
        _skip(f"{name} not set")
        return True

    try:
        derived = _public_key_base64_from_pem(pem)
        if derived != expected_manifest_key:
            _fail(
                f"{name} does not match manifest.key in wxt.config.ts "
                f"(derived public key differs)"
            )
            return False
        _ok(f"{name} matches extension manifest.key")
        return True
    except Exception as exc:
        _fail(f"{name}: {exc}")
        return False


def main() -> int:
    print("Pane release secret verification\n")
    expected = load_expected_keys()
    results: list[bool] = []

    sparkle = os.environ.get("SPARKLE_PRIVATE_KEY", "").strip()
    if sparkle:
        results.append(verify_sparkle_private_key(sparkle, expected))
    else:
        _skip("SPARKLE_PRIVATE_KEY not set")

    agent = os.environ.get("AGENT_EXTENSION_PRIVATE_KEY", "").strip()
    results.append(
        verify_extension_private_key(
            "AGENT_EXTENSION_PRIVATE_KEY",
            agent,
            expected["extensions"]["agent"]["manifestKeyBase64"],
        )
    )

    claw = os.environ.get("CLAW_EXTENSION_PRIVATE_KEY", "").strip()
    results.append(
        verify_extension_private_key(
            "CLAW_EXTENSION_PRIVATE_KEY",
            claw,
            expected["extensions"]["claw"]["manifestKeyBase64"],
        )
    )

    print()
    if not sparkle:
        print("Note: SPARKLE_PRIVATE_KEY is required for signed browser/server appcasts.")
    if not agent:
        print(
            "Note: AGENT_EXTENSION_PRIVATE_KEY is required to ship .crx files "
            "(browser bundling + extension OTA)."
        )

    failed = [r for r in results if r is False]
    if failed:
        print(f"\n{len(failed)} check(s) failed.", file=sys.stderr)
        return 1

    print("\nAll configured secrets look valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
