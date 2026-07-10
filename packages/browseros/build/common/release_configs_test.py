#!/usr/bin/env python3
"""Tests for release config resource phase coverage."""

import unittest
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


class ReleaseResourceConfigTest(unittest.TestCase):
    def test_single_arch_release_configs_run_resource_phases(self):
        configs = [
            "release.macos.arm64.yaml",
            "release.macos.arm64.noupload.yaml",
            "release.macos.arm64.unsigned.yaml",
            "release.macos.arm64.ci.yaml",
            "release.linux.noupload.yaml",
            "release.windows.yaml",
            "release.windows.ci.yaml",
            "release.linux.yaml",
            "release.linux.ci.yaml",
        ]

        for config_name in configs:
            with self.subTest(config=config_name):
                modules = self._modules(config_name)
                self.assertLess(
                    modules.index("download_resources"),
                    modules.index("resources"),
                )
                self.assertLess(
                    modules.index("resources"),
                    modules.index("bundled_extensions"),
                )

    def test_macos_universal_downloads_and_bundles_before_universal_build(self):
        modules = self._modules("release.macos.yaml")

        self.assertLess(modules.index("download_resources"), modules.index("bundled_extensions"))
        self.assertLess(modules.index("bundled_extensions"), modules.index("universal_build"))

    def _modules(self, config_name: str) -> list[str]:
        return yaml.safe_load((CONFIG_DIR / config_name).read_text())["modules"]


if __name__ == "__main__":
    unittest.main()
