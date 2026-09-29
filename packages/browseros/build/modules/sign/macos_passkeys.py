"""Provision Apple's managed browser-passkey capability for Developer ID builds."""

import plistlib
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from ...common.utils import log_warning


PASSKEY_ENTITLEMENT = "com.apple.developer.web-browser.public-key-credential"
APP_IDENTIFIER = "com.apple.application-identifier"
BUNDLE_ID = "com.panebrowser.app"


def validate_profile(profile: dict, bundle_id: str) -> dict:
    """Return only the identity and capability needed by the browser process."""
    entitlements = profile.get("Entitlements", {})
    if entitlements.get(PASSKEY_ENTITLEMENT) is not True:
        raise ValueError("Provisioning profile lacks Apple's browser-passkey entitlement")
    app_identifier = entitlements.get(APP_IDENTIFIER, "")
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    if not any(app_identifier == f"{prefix}.{bundle_id}" for prefix in prefixes):
        raise ValueError(f"Provisioning profile is not for {bundle_id}")
    expiration = profile.get("ExpirationDate")
    if not isinstance(expiration, datetime) or expiration.replace(
        tzinfo=timezone.utc
    ) <= datetime.now(timezone.utc):
        raise ValueError("Provisioning profile is expired or has no expiration date")
    if profile.get("ProvisionsAllDevices") is not True:
        raise ValueError("Passkeys require a Developer ID distribution provisioning profile")
    return {APP_IDENTIFIER: app_identifier, PASSKEY_ENTITLEMENT: True}


@contextmanager
def passkey_signing_entitlements(
    app_path: Path,
    base_entitlements: Optional[Path],
    profile_path: Optional[str],
) -> Iterator[Optional[Path]]:
    """Embed an approved profile and merge its capability into app entitlements.

    Repackaging preserves an existing profile. Unsigned/developer builds without
    a profile must not claim a managed capability that macOS has not granted.
    """
    embedded = app_path / "Contents" / "embedded.provisionprofile"
    source = Path(profile_path).expanduser() if profile_path else embedded
    entitlements = (
        plistlib.loads(base_entitlements.read_bytes()) if base_entitlements else {}
    )
    if not source.is_file():
        if profile_path or entitlements.get(PASSKEY_ENTITLEMENT):
            raise ValueError(f"Browser-passkey provisioning profile not found: {source}")
        log_warning(
            "iCloud passkeys are unavailable: set MACOS_PASSKEY_PROVISIONING_PROFILE "
            "to Pane's Apple-approved Developer ID provisioning profile."
        )
        yield base_entitlements
        return

    decoded = subprocess.run(
        ["security", "cms", "-D", "-i", str(source)],
        check=True,
        capture_output=True,
    )
    info = plistlib.loads((app_path / "Contents" / "Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != BUNDLE_ID:
        raise ValueError(f"Browser-passkey signing requires bundle ID {BUNDLE_ID}")
    entitlements.update(validate_profile(plistlib.loads(decoded.stdout), BUNDLE_ID))
    if source.resolve() != embedded.resolve():
        shutil.copyfile(source, embedded)
    with tempfile.TemporaryDirectory(prefix="pane-passkeys-") as tmp:
        merged = Path(tmp) / "app-entitlements.plist"
        merged.write_bytes(plistlib.dumps(entitlements))
        yield merged
