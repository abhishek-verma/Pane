#!/usr/bin/env python3
"""Tests for core patch application logic against a mock git checkout."""

import tempfile
import unittest
from pathlib import Path

from .common import apply_single_patch, find_patch_files, process_patch_list
from ...common.testing import MockChromium

ORIGINAL = "line one\nline two\nline three\n"

GOOD_PATCH = """\
--- a/chrome/feature.txt
+++ b/chrome/feature.txt
@@ -1,3 +1,3 @@
 line one
-line two
+line 2!
 line three
"""

PATCHED = "line one\nline 2!\nline three\n"

# Context lines that don't exist in the target file, so application fails.
BAD_PATCH = """\
--- a/chrome/feature.txt
+++ b/chrome/feature.txt
@@ -1,3 +1,3 @@
 alpha
-beta
+gamma
 delta
"""

NEW_FILE_PATCH = """\
--- /dev/null
+++ b/chrome/created.txt
@@ -0,0 +1 @@
+created
"""


class FindPatchFilesTest(unittest.TestCase):
    def test_missing_dir_returns_empty(self):
        self.assertEqual(find_patch_files(Path("/nonexistent/patches")), [])

    def test_filters_markers_and_dotfiles_and_sorts(self):
        with tempfile.TemporaryDirectory() as tmp:
            patches = Path(tmp)
            (patches / "sub").mkdir()
            (patches / "b.patch").write_text("x")
            (patches / "sub" / "a.patch").write_text("x")
            (patches / "gone.patch.deleted").write_text("x")
            (patches / "image.patch.binary").write_text("x")
            (patches / "moved.patch.rename").write_text("x")
            (patches / ".hidden").write_text("x")

            found = find_patch_files(patches)

            self.assertEqual(
                found, [patches / "b.patch", patches / "sub" / "a.patch"]
            )


class ApplySinglePatchTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.chromium = MockChromium(Path(self._tmp.name))
        self.chromium.add_file("chrome/feature.txt", ORIGINAL)
        self.chromium.with_git()

    def _write_patch(self, content: str) -> Path:
        patch = Path(self._tmp.name) / "test.patch"
        patch.write_text(content)
        return patch

    def test_good_patch_applies_and_modifies_file(self):
        patch = self._write_patch(GOOD_PATCH)

        success, error = apply_single_patch(patch, self.chromium.src)

        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(
            (self.chromium.src / "chrome" / "feature.txt").read_text(), PATCHED
        )

    def test_bad_patch_fails_and_leaves_file_unchanged(self):
        patch = self._write_patch(BAD_PATCH)

        success, error = apply_single_patch(patch, self.chromium.src)

        self.assertFalse(success)
        self.assertTrue(error)
        self.assertEqual(
            (self.chromium.src / "chrome" / "feature.txt").read_text(), ORIGINAL
        )

    def test_dry_run_checks_without_modifying(self):
        patch = self._write_patch(GOOD_PATCH)

        success, error = apply_single_patch(patch, self.chromium.src, dry_run=True)

        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(
            (self.chromium.src / "chrome" / "feature.txt").read_text(), ORIGINAL
        )

    def test_dry_run_reports_failing_patch(self):
        patch = self._write_patch(BAD_PATCH)

        success, _ = apply_single_patch(patch, self.chromium.src, dry_run=True)

        self.assertFalse(success)

    def test_patch_can_create_new_file(self):
        patch = self._write_patch(NEW_FILE_PATCH)

        success, _ = apply_single_patch(patch, self.chromium.src)

        self.assertTrue(success)
        self.assertEqual(
            (self.chromium.src / "chrome" / "created.txt").read_text(), "created\n"
        )


class ProcessPatchListTest(unittest.TestCase):
    def test_counts_applied_and_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            chromium = MockChromium(Path(tmp))
            chromium.add_file("chrome/feature.txt", ORIGINAL)
            chromium.with_git()

            patches_dir = Path(tmp) / "patches"
            patches_dir.mkdir()
            good = patches_dir / "good.patch"
            good.write_text(GOOD_PATCH)
            missing = patches_dir / "missing.patch"

            applied, failed = process_patch_list(
                [(good, "good.patch"), (missing, "missing.patch")],
                chromium.src,
                patches_dir,
            )

            self.assertEqual(applied, 1)
            self.assertEqual(failed, ["missing.patch"])


if __name__ == "__main__":
    unittest.main()
