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

    def _write_mirrored_patch(self, content: str, relative_path: str) -> Path:
        """Write a patch at a path mirroring the target chromium file's path.

        apply_single_patch derives the target file's path from
        patch_path.relative_to(relative_to) — reset_to needs that to resolve
        to the real chromium-relative path (e.g. "chrome/feature.txt"), not
        an arbitrary patch filename.
        """
        patch = Path(self._tmp.name) / relative_path
        patch.parent.mkdir(parents=True, exist_ok=True)
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

    def test_reset_to_dry_run_checks_against_base_not_working_tree(self):
        # The working tree already has this (or another) patch applied, so a
        # naive check against its current content would see mismatched
        # context and wrongly report failure. --reset-to + dry_run must check
        # against the base commit's content instead.
        base_commit = self.chromium._git("rev-parse", "HEAD").stdout.strip()
        feature_file = self.chromium.src / "chrome" / "feature.txt"
        feature_file.write_text(PATCHED)
        patch = self._write_mirrored_patch(GOOD_PATCH, "chrome/feature.txt")

        success, error = apply_single_patch(
            patch,
            self.chromium.src,
            dry_run=True,
            reset_to=base_commit,
            relative_to=Path(self._tmp.name),
        )

        self.assertTrue(success)
        self.assertIsNone(error)
        # Dry run: the already-patched working tree must be left exactly as
        # it was, not reset to base and not left at some in-between state.
        self.assertEqual(feature_file.read_text(), PATCHED)

    def test_reset_to_dry_run_leaves_working_tree_untouched_when_patch_would_fail(
        self,
    ):
        base_commit = self.chromium._git("rev-parse", "HEAD").stdout.strip()
        feature_file = self.chromium.src / "chrome" / "feature.txt"
        feature_file.write_text(PATCHED)
        patch = self._write_mirrored_patch(BAD_PATCH, "chrome/feature.txt")

        success, error = apply_single_patch(
            patch,
            self.chromium.src,
            dry_run=True,
            reset_to=base_commit,
            relative_to=Path(self._tmp.name),
        )

        self.assertFalse(success)
        self.assertTrue(error)
        self.assertEqual(feature_file.read_text(), PATCHED)

    def test_reset_to_dry_run_new_file_not_in_base_leaves_working_tree_untouched(self):
        # File exists on disk (e.g. from a previous real apply) but not in
        # the base commit: the check must validate the "create fresh" patch
        # without ever touching the real working-tree copy.
        base_commit = self.chromium._git("rev-parse", "HEAD").stdout.strip()
        created_file = self.chromium.src / "chrome" / "created.txt"
        created_file.parent.mkdir(parents=True, exist_ok=True)
        created_file.write_text("already there\n")
        patch = self._write_mirrored_patch(NEW_FILE_PATCH, "chrome/created.txt")

        success, error = apply_single_patch(
            patch,
            self.chromium.src,
            dry_run=True,
            reset_to=base_commit,
            relative_to=Path(self._tmp.name),
        )

        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(created_file.read_text(), "already there\n")

    def test_reset_to_dry_run_does_not_create_stray_directories_in_working_tree(self):
        # A patch that creates a file under a not-yet-existing directory must
        # not leave that directory behind in the real checkout after a dry
        # run, even though building the base content requires creating it
        # somewhere (in the scratch copy, not chromium_src).
        base_commit = self.chromium._git("rev-parse", "HEAD").stdout.strip()
        nested_new_file_patch = NEW_FILE_PATCH.replace(
            "chrome/created.txt", "chrome/new_feature/created.txt"
        )
        patch = self._write_mirrored_patch(
            nested_new_file_patch, "chrome/new_feature/created.txt"
        )

        success, error = apply_single_patch(
            patch,
            self.chromium.src,
            dry_run=True,
            reset_to=base_commit,
            relative_to=Path(self._tmp.name),
        )

        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertFalse((self.chromium.src / "chrome" / "new_feature").exists())


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
