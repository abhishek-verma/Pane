#!/usr/bin/env python3
"""Import Developer ID .p12 into a temporary keychain for CI codesign.

Used by .github/workflows/release-browser.yml before `browseros build`.
Reads DEVELOPER_ID_P12 (base64) + P12_PASSWORD from the environment.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running as `python3 packages/browseros/scripts/ci/import-signing-identity.py`
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from build.modules.sign.macos import import_developer_id_certificate  # noqa: E402
from build.common.env import EnvConfig  # noqa: E402


def main() -> int:
    path = import_developer_id_certificate(EnvConfig())
    if path is None:
        print(
            "DEVELOPER_ID_P12 not set — assuming signing identity is already in the keychain",
            file=sys.stderr,
        )
        return 0
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
