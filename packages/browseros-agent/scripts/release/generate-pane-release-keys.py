#!/usr/bin/env python3
"""Generate Pane-owned release signing keys (not BrowserOS).

Creates:
  secrets/pane-release/               gitignored private key material
  scripts/release/pane-release-keys.public.json   committed public keys + extension IDs

Then runs apply-pane-release-keys.py to update the repo.

Usage:
  python3 packages/browseros-agent/scripts/release/generate-pane-release-keys.py

Re-run only when rotating keys (breaks update trust for existing installs).
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
SECRETS_DIR = REPO_ROOT / "secrets" / "pane-release"
PUBLIC_JSON = SCRIPT_DIR / "pane-release-keys.public.json"
APPLY_SCRIPT = SCRIPT_DIR / "apply-pane-release-keys.py"


def chrome_extension_id_from_manifest_key(manifest_key_b64: str) -> str:
    import hashlib

    pub_key_bytes = base64.b64decode(manifest_key_b64)
    hex_digest = hashlib.sha256(pub_key_bytes).hexdigest()[:32]
    return "".join(chr(ord("a") + int(char, 16)) for char in hex_digest)


def generate_rsa_extension_key() -> tuple[bytes, str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    manifest_key = base64.b64encode(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    ).decode("ascii")
    extension_id = chrome_extension_id_from_manifest_key(manifest_key)
    return pem, manifest_key, extension_id


def generate_sparkle_keys() -> tuple[str, str]:
    private_key = ed25519.Ed25519PrivateKey.generate()
    seed = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    private_b64 = base64.b64encode(seed + public_raw).decode("ascii")
    public_b64 = base64.b64encode(public_raw).decode("ascii")
    return private_b64, public_b64


def main() -> int:
    if SECRETS_DIR.exists() and any(SECRETS_DIR.iterdir()):
        print(
            f"Refusing to overwrite existing keys in {SECRETS_DIR}.\n"
            "Delete that directory first if you intend to rotate keys.",
            file=sys.stderr,
        )
        return 1

    SECRETS_DIR.mkdir(parents=True, exist_ok=True)

    sparkle_private_b64, sparkle_public_b64 = generate_sparkle_keys()
    agent_pem, agent_manifest_key, agent_id = generate_rsa_extension_key()
    claw_pem, claw_manifest_key, claw_id = generate_rsa_extension_key()

    (SECRETS_DIR / "sparkle-private.b64").write_text(sparkle_private_b64 + "\n")
    (SECRETS_DIR / "sparkle-public.b64").write_text(sparkle_public_b64 + "\n")
    (SECRETS_DIR / "agent-extension.pem").write_bytes(agent_pem)
    (SECRETS_DIR / "claw-extension.pem").write_bytes(claw_pem)
    (SECRETS_DIR / "README.txt").write_text(
        "Pane release private keys — NEVER commit this directory.\n"
        "Upload to GitHub with scripts/release/setup-github-release-secrets.sh\n"
    )

    public_doc = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "product": "Pane",
        "sparkle": {
            "publicKeyBase64": sparkle_public_b64,
            "note": "SUPublicEDKey / WinSparkle / server OTA verification",
        },
        "extensions": {
            "agent": {
                "id": agent_id,
                "manifestKeyBase64": agent_manifest_key,
            },
            "claw": {
                "id": claw_id,
                "manifestKeyBase64": claw_manifest_key,
            },
        },
    }
    PUBLIC_JSON.write_text(json.dumps(public_doc, indent=2) + "\n")

    print(f"Wrote private keys to {SECRETS_DIR}/")
    print(f"Wrote public keys to {PUBLIC_JSON}")
    print(f"  Sparkle public: {sparkle_public_b64}")
    print(f"  Agent extension id: {agent_id}")
    print(f"  Claw extension id:  {claw_id}")

    subprocess.run([sys.executable, str(APPLY_SCRIPT)], check=True)
    print("\nNext: upload secrets to GitHub:")
    print("  packages/browseros-agent/scripts/release/setup-github-release-secrets.sh \\")
    print(f"    --sparkle {SECRETS_DIR}/sparkle-private.b64 \\")
    print(f"    --agent {SECRETS_DIR}/agent-extension.pem \\")
    print(f"    --claw {SECRETS_DIR}/claw-extension.pem")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
