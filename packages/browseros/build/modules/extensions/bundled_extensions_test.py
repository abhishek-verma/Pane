#!/usr/bin/env python3
"""Tests for bundled extension manifest handling."""

import json
import tempfile
import unittest
from pathlib import Path

from build.modules.extensions.bundled_extensions import (
    PANE_BUNDLED_EXTENSION_IDS,
    REQUIRED_BUNDLED_EXTENSION_IDS,
    BundledExtensionsModule,
    ExtensionInfo,
    get_required_bundled_extension_ids,
)

CLAW_EXTENSION_ID = "cmlhocfcmfhegcblpkphkcnoiglonenf"


class BundledExtensionsManifestTest(unittest.TestCase):
    def test_bundled_manifest_parses_requested_alpha_entries(self) -> None:
        repo_root = Path(__file__).resolve().parents[5]
        manifest_path = repo_root / "updates" / "extensions" / "bundled-manifest.xml"

        extensions = BundledExtensionsModule()._parse_manifest_xml(
            manifest_path.read_text()
        )

        self.assertEqual(
            extensions,
            [
                ExtensionInfo(
                    id="biedncddmddkpapdplhcnkhhplnfgbif",
                    version="0.0.100",
                    codebase="https://github.com/abhishek-verma/Pane/releases/download/agent-extension/v0.0.100/pane-agent-0.0.100.crx",
                ),
            ],
        )

    def test_required_ids_cover_agent_bug_reporter_and_claw(self) -> None:
        self.assertEqual(
            REQUIRED_BUNDLED_EXTENSION_IDS,
            {
                "adlpneommgkgeanpaekgoaolcpncohkf": "Pane bug reporter",
                "biedncddmddkpapdplhcnkhhplnfgbif": "Pane agent",
                CLAW_EXTENSION_ID: "Pane Claw app",
            },
        )

    def test_pane_build_requires_agent_only(self) -> None:
        self.assertEqual(
            PANE_BUNDLED_EXTENSION_IDS,
            {"biedncddmddkpapdplhcnkhhplnfgbif": "Pane agent"},
        )
        self.assertEqual(
            get_required_bundled_extension_ids(),
            PANE_BUNDLED_EXTENSION_IDS,
        )

    def test_generated_json_maps_claw_id_to_crx(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            BundledExtensionsModule()._generate_json(
                [
                    ExtensionInfo(
                        id=CLAW_EXTENSION_ID,
                        version="0.0.1",
                        codebase=(
                            "https://cdn.browseros.com/extensions/"
                            "browserclaw-0.0.1.crx"
                        ),
                    )
                ],
                output_dir,
            )

            data = json.loads((output_dir / "bundled_extensions.json").read_text())

        self.assertEqual(
            data[CLAW_EXTENSION_ID],
            {
                "external_crx": f"{CLAW_EXTENSION_ID}.crx",
                "external_version": "0.0.1",
            },
        )

    def test_missing_claw_app_fails_validation_when_not_pane_build(self) -> None:
        import os

        extensions = [
            ExtensionInfo(
                id="adlpneommgkgeanpaekgoaolcpncohkf",
                version="52.0.0.0",
                codebase="https://cdn.browseros.com/extensions/bugreporter.crx",
            ),
            ExtensionInfo(
                id="biedncddmddkpapdplhcnkhhplnfgbif",
                version="0.0.115.0",
                codebase="https://cdn.browseros.com/extensions/agent.crx",
            ),
        ]

        old = os.environ.get("PANE_BUILD")
        os.environ["PANE_BUILD"] = "false"
        try:
            with self.assertRaisesRegex(
                RuntimeError,
                f"Pane Claw app \\({CLAW_EXTENSION_ID}\\)",
            ):
                BundledExtensionsModule()._validate_required_extensions(extensions)
        finally:
            if old is None:
                os.environ.pop("PANE_BUILD", None)
            else:
                os.environ["PANE_BUILD"] = old

    def test_pane_build_allows_agent_only_manifest(self) -> None:
        extensions = [
            ExtensionInfo(
                id="biedncddmddkpapdplhcnkhhplnfgbif",
                version="0.0.100",
                codebase="https://github.com/abhishek-verma/Pane/releases/download/agent-extension/v0.0.100/pane-agent-0.0.100.crx",
            ),
        ]
        BundledExtensionsModule()._validate_required_extensions(extensions)


if __name__ == "__main__":
    unittest.main()
