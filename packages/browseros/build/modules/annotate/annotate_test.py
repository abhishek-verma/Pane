#!/usr/bin/env python3
"""Tests for feature-based commit annotation against a mock git checkout."""

import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import cast

from .annotate import (
    _is_git_index_lock_error,
    annotate_features,
    get_modified_files,
    git_add_and_commit,
    load_features,
)
from ...common.testing import MockBrowserOSRoot, MockChromium, make_context


class IsGitIndexLockErrorTest(unittest.TestCase):
    def test_detects_lock_error(self):
        stderr = (
            "fatal: Unable to create '/repo/.git/index.lock': File exists.\n"
            "Another git process seems to be running"
        )
        self.assertTrue(_is_git_index_lock_error(stderr))

    def test_is_case_insensitive(self):
        self.assertTrue(
            _is_git_index_lock_error("INDEX.LOCK trouble: FILE EXISTS")
        )

    def test_other_errors_not_detected(self):
        self.assertFalse(_is_git_index_lock_error("fatal: not a git repository"))
        self.assertFalse(_is_git_index_lock_error(""))
        # CompletedProcess.stderr can be None when output isn't captured;
        # the guard must tolerate it even though the annotation says str.
        self.assertFalse(_is_git_index_lock_error(cast(str, None)))


class LoadFeaturesTest(unittest.TestCase):
    def test_missing_file_returns_empty(self):
        self.assertEqual(load_features(Path("/nonexistent/features.yaml")), {})

    def test_loads_features_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = MockBrowserOSRoot(Path(tmp))
            path = root.write_features_yaml(
                {"llm-chat": {"description": "feat: chat", "files": ["a.cc"]}}
            )
            features = load_features(path)
            self.assertEqual(features["llm-chat"]["files"], ["a.cc"])


class GetModifiedFilesTest(unittest.TestCase):
    def test_detects_modified_and_untracked_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            chromium = MockChromium(Path(tmp))
            chromium.add_file("chrome/dirty.cc", "v1")
            chromium.add_file("chrome/clean.cc", "v1")
            chromium.with_git()

            chromium.add_file("chrome/dirty.cc", "v2")
            chromium.add_file("chrome/untracked.cc", "new")

            modified = get_modified_files(
                chromium.src,
                [
                    "chrome/dirty.cc",
                    "chrome/clean.cc",
                    "chrome/untracked.cc",
                    "chrome/nonexistent.cc",
                ],
            )

            self.assertEqual(
                modified, ["chrome/dirty.cc", "chrome/untracked.cc"]
            )


class GitAddAndCommitTest(unittest.TestCase):
    def test_commits_listed_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            chromium = MockChromium(Path(tmp))
            chromium.add_file("chrome/dirty.cc", "v1")
            chromium.with_git()
            chromium.add_file("chrome/dirty.cc", "v2")

            self.assertTrue(
                git_add_and_commit(chromium.src, ["chrome/dirty.cc"], "feat: dirty")
            )

            subject = subprocess.run(
                ["git", "log", "-1", "--format=%s"],
                cwd=chromium.src,
                capture_output=True,
                text=True,
            ).stdout.strip()
            self.assertEqual(subject, "feat: dirty")

    def test_clean_tree_returns_false(self):
        with tempfile.TemporaryDirectory() as tmp:
            chromium = MockChromium(Path(tmp))
            chromium.add_file("chrome/clean.cc", "v1")
            chromium.with_git()

            self.assertFalse(
                git_add_and_commit(chromium.src, ["chrome/clean.cc"], "feat: noop")
            )


class AnnotateFeaturesTest(unittest.TestCase):
    def setUp(self):
        self._chromium_tmp = tempfile.TemporaryDirectory()
        self._root_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._chromium_tmp.cleanup)
        self.addCleanup(self._root_tmp.cleanup)
        self.chromium = MockChromium(Path(self._chromium_tmp.name))
        self.chromium.add_file("chrome/feature_a.cc", "v1")
        self.chromium.add_file("chrome/feature_b.cc", "v1")
        self.chromium.with_git()
        self.root = MockBrowserOSRoot(Path(self._root_tmp.name))
        self.ctx = make_context(self.chromium, self.root)

    def _last_commit_subject(self) -> str:
        return subprocess.run(
            ["git", "log", "-1", "--format=%s"],
            cwd=self.chromium.src,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def test_missing_features_yaml_returns_zero(self):
        self.assertEqual(annotate_features(self.ctx), (0, 0))

    def test_commits_feature_with_modified_files(self):
        self.chromium.add_file("chrome/feature_a.cc", "v2")
        self.root.write_features_yaml(
            {
                "feature-a": {
                    "description": "feat: feature A",
                    "files": ["chrome/feature_a.cc"],
                }
            }
        )

        commits, skipped = annotate_features(self.ctx)

        self.assertEqual((commits, skipped), (1, 0))
        self.assertEqual(self._last_commit_subject(), "feat: feature A")

    def test_clean_feature_is_skipped(self):
        self.root.write_features_yaml(
            {
                "feature-b": {
                    "description": "feat: feature B",
                    "files": ["chrome/feature_b.cc"],
                }
            }
        )

        self.assertEqual(annotate_features(self.ctx), (0, 1))

    def test_feature_without_files_is_skipped(self):
        self.root.write_features_yaml(
            {"empty-feature": {"description": "feat: empty", "files": []}}
        )

        self.assertEqual(annotate_features(self.ctx), (0, 1))

    def test_unknown_feature_filter_returns_zero(self):
        self.root.write_features_yaml(
            {
                "feature-a": {
                    "description": "feat: feature A",
                    "files": ["chrome/feature_a.cc"],
                }
            }
        )

        self.assertEqual(
            annotate_features(self.ctx, feature_filter="nope"), (0, 0)
        )

    def test_feature_filter_limits_to_one_feature(self):
        self.chromium.add_file("chrome/feature_a.cc", "v2")
        self.chromium.add_file("chrome/feature_b.cc", "v2")
        self.root.write_features_yaml(
            {
                "feature-a": {
                    "description": "feat: feature A",
                    "files": ["chrome/feature_a.cc"],
                },
                "feature-b": {
                    "description": "feat: feature B",
                    "files": ["chrome/feature_b.cc"],
                },
            }
        )

        commits, skipped = annotate_features(self.ctx, feature_filter="feature-a")

        self.assertEqual((commits, skipped), (1, 0))
        self.assertEqual(self._last_commit_subject(), "feat: feature A")


if __name__ == "__main__":
    unittest.main()
