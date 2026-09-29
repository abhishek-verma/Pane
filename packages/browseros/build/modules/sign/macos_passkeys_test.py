"""Regression coverage for profile-backed iCloud passkey signing."""

import os
import plistlib
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from . import macos
from .macos_passkeys import (
    APP_IDENTIFIER,
    BUNDLE_ID,
    PASSKEY_ENTITLEMENT,
    passkey_signing_entitlements,
    validate_profile,
)


def approved_profile():
    return {
        "ApplicationIdentifierPrefix": ["TESTTEAM"],
        "ExpirationDate": datetime.now() + timedelta(days=30),
        "ProvisionsAllDevices": True,
        "Entitlements": {
            APP_IDENTIFIER: f"TESTTEAM.{BUNDLE_ID}",
            PASSKEY_ENTITLEMENT: True,
            "unrelated-capability": True,
        },
    }


class PasskeyProfileTest(unittest.TestCase):
    def test_rejects_missing_capability_wrong_app_expired_and_development_profiles(self):
        for change in ("capability", "app", "expiry", "development"):
            with self.subTest(change=change):
                profile = approved_profile()
                if change == "capability":
                    profile["Entitlements"][PASSKEY_ENTITLEMENT] = False
                elif change == "app":
                    profile["Entitlements"][APP_IDENTIFIER] = "TESTTEAM.com.other.app"
                elif change == "expiry":
                    profile["ExpirationDate"] = datetime.now() - timedelta(days=1)
                else:
                    profile["ProvisionsAllDevices"] = False
                with self.assertRaises(ValueError):
                    validate_profile(profile, BUNDLE_ID)

    def test_unprovisioned_build_does_not_claim_managed_capability(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp) / "Pane.app"
            with passkey_signing_entitlements(app, None, None) as result:
                self.assertIsNone(result)
            with self.assertRaisesRegex(ValueError, "not found"):
                with passkey_signing_entitlements(app, None, str(Path(tmp) / "missing")):
                    self.fail("Missing configured profiles must fail signing")

    def test_rejects_managed_entitlement_without_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "entitlements.plist"
            base.write_bytes(plistlib.dumps({PASSKEY_ENTITLEMENT: True}))
            with self.assertRaisesRegex(ValueError, "not found"):
                with passkey_signing_entitlements(Path(tmp) / "Pane.app", base, None):
                    self.fail("Unprovisioned managed entitlement must fail signing")

    def test_profile_is_embedded_and_merged_entitlements_reach_bundle_signer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = root / "Pane.app"
            executable = app / "Contents/MacOS/Pane"
            executable.parent.mkdir(parents=True)
            executable.touch()
            (app / "Contents/Info.plist").write_bytes(
                plistlib.dumps({"CFBundleIdentifier": BUNDLE_ID})
            )
            base = root / "resources/entitlements/app-entitlements.plist"
            base.parent.mkdir(parents=True)
            base_data = {"com.apple.security.device.camera": True}
            base.write_bytes(plistlib.dumps(base_data))
            source = root / "approved.provisionprofile"
            source.write_bytes(b"signed CMS profile fixture")
            embedded = app / "Contents/embedded.provisionprofile"
            signed = []

            def record_signing(cmd, **kwargs):
                self.assertEqual(cmd[-1], str(app))
                merged = Path(cmd[cmd.index("--entitlements") + 1])
                signed.append(merged)
                self.assertEqual(
                    plistlib.loads(merged.read_bytes()),
                    {
                        **base_data,
                        APP_IDENTIFIER: f"TESTTEAM.{BUNDLE_ID}",
                        PASSKEY_ENTITLEMENT: True,
                    },
                )
                self.assertEqual(embedded.read_bytes(), source.read_bytes())

            components = dict.fromkeys(
                ["xpc_services", "apps", "executables", "dylibs", "helpers", "frameworks"],
                [],
            )
            decoded = subprocess.CompletedProcess(
                [], 0, stdout=plistlib.dumps(approved_profile()), stderr=b""
            )
            with (
                mock.patch.dict(os.environ, {"MACOS_PASSKEY_PROVISIONING_PROFILE": str(source)}),
                mock.patch.object(macos, "find_components_to_sign", return_value=components),
                mock.patch.object(macos, "sign_component", return_value=True),
                mock.patch.object(macos, "run_command", side_effect=record_signing),
                mock.patch("subprocess.run", return_value=decoded) as decode,
            ):
                self.assertTrue(macos.sign_all_components(app, "Developer ID test", root))
                decode.assert_called_once_with(
                    ["security", "cms", "-D", "-i", str(source)],
                    check=True,
                    capture_output=True,
                )
                # A later repackage retains the entitlement without the env var.
                with mock.patch.dict(os.environ, {"MACOS_PASSKEY_PROVISIONING_PROFILE": ""}):
                    self.assertTrue(macos.sign_all_components(app, "Developer ID test", root))
            self.assertEqual(len(signed), 2)
            self.assertTrue(all(not path.exists() for path in signed))
            self.assertEqual(plistlib.loads(base.read_bytes()), base_data)


if __name__ == "__main__":
    unittest.main()
