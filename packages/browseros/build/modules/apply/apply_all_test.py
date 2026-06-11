#!/usr/bin/env python3
"""Tests for apply_all_patches against a mock checkout and patches dir."""

import tempfile
import unittest
from pathlib import Path

from .apply_all import apply_all_patches
from .common_test import BAD_PATCH, GOOD_PATCH, NEW_FILE_PATCH, ORIGINAL, PATCHED
from ...common.testing import MockBrowserOSRoot, MockChromium, make_context


class ApplyAllPatchesTest(unittest.TestCase):
    def setUp(self):
        self._chromium_tmp = tempfile.TemporaryDirectory()
        self._root_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._chromium_tmp.cleanup)
        self.addCleanup(self._root_tmp.cleanup)
        self.chromium = MockChromium(Path(self._chromium_tmp.name))
        self.root = MockBrowserOSRoot(Path(self._root_tmp.name))
        self.ctx = make_context(self.chromium, self.root)

    def test_missing_patches_dir_returns_zero(self):
        self.assertEqual(apply_all_patches(self.ctx), (0, []))

    def test_empty_patches_dir_returns_zero(self):
        (self.root.root / "chromium_patches").mkdir()
        self.assertEqual(apply_all_patches(self.ctx), (0, []))

    def test_applies_nested_patches(self):
        self.chromium.add_file("chrome/feature.txt", ORIGINAL)
        self.chromium.with_git()
        self.root.add_patch("chrome/feature.txt.patch", GOOD_PATCH)
        self.root.add_patch("chrome/sub/created.txt.patch", NEW_FILE_PATCH)

        applied, failed = apply_all_patches(self.ctx)

        self.assertEqual(applied, 2)
        self.assertEqual(failed, [])
        self.assertEqual(
            (self.chromium.src / "chrome" / "feature.txt").read_text(), PATCHED
        )
        self.assertEqual(
            (self.chromium.src / "chrome" / "created.txt").read_text(), "created\n"
        )

    def test_failed_patch_is_reported_and_others_still_apply(self):
        self.chromium.add_file("chrome/feature.txt", ORIGINAL)
        self.chromium.with_git()
        self.root.add_patch("chrome/feature.txt.patch", GOOD_PATCH)
        self.root.add_patch("chrome/broken.txt.patch", BAD_PATCH)

        applied, failed = apply_all_patches(self.ctx)

        self.assertEqual(applied, 1)
        self.assertEqual(failed, [Path("chrome/broken.txt.patch")])

    def test_dry_run_does_not_modify_files(self):
        self.chromium.add_file("chrome/feature.txt", ORIGINAL)
        self.chromium.with_git()
        self.root.add_patch("chrome/feature.txt.patch", GOOD_PATCH)

        applied, failed = apply_all_patches(self.ctx, dry_run=True)

        self.assertEqual(applied, 1)
        self.assertEqual(failed, [])
        self.assertEqual(
            (self.chromium.src / "chrome" / "feature.txt").read_text(), ORIGINAL
        )


if __name__ == "__main__":
    unittest.main()
