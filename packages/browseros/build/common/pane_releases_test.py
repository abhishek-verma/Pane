#!/usr/bin/env python3
"""Tests for Pane release URL helpers."""

import unittest

from .pane_releases import (
    PANE_EXTENSION_UPDATE_MANIFEST_URL,
    github_release_download_url,
)


class PaneReleasesTest(unittest.TestCase):
    def test_extension_update_manifest_uses_raw_github(self) -> None:
        self.assertIn("raw.githubusercontent.com/abhishek-verma/Pane/main", PANE_EXTENSION_UPDATE_MANIFEST_URL)
        self.assertTrue(PANE_EXTENSION_UPDATE_MANIFEST_URL.endswith("/updates/extensions/update-manifest.xml"))

    def test_github_release_download_url_encodes_tag(self) -> None:
        url = github_release_download_url("agent-extension/v1.2.3", "pane-agent-1.2.3-chrome.zip")
        self.assertEqual(
            url,
            "https://github.com/abhishek-verma/Pane/releases/download/agent-extension%2Fv1.2.3/pane-agent-1.2.3-chrome.zip",
        )


if __name__ == "__main__":
    unittest.main()
