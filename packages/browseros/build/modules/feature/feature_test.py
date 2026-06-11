#!/usr/bin/env python3
"""Tests for feature-to-file mapping against a mock git checkout."""

import tempfile
import unittest
from pathlib import Path

import yaml

from .feature import add_or_update_feature
from ...common.testing import MockBrowserOSRoot, MockChromium, make_context


class AddOrUpdateFeatureTest(unittest.TestCase):
    def setUp(self):
        self._chromium_tmp = tempfile.TemporaryDirectory()
        self._root_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._chromium_tmp.cleanup)
        self.addCleanup(self._root_tmp.cleanup)
        self.chromium = MockChromium(Path(self._chromium_tmp.name)).with_git()
        self.root = MockBrowserOSRoot(Path(self._root_tmp.name))
        self.ctx = make_context(self.chromium, self.root)

    def _load_features(self) -> dict:
        path = self.ctx.get_features_yaml_path()
        return yaml.safe_load(path.read_text())["features"]

    def test_invalid_name_rejected_without_writing(self):
        success, error = add_or_update_feature(
            self.ctx, "Bad Name", "HEAD", "feat: x"
        )
        self.assertFalse(success)
        self.assertIn("spaces", error)
        self.assertFalse(self.ctx.get_features_yaml_path().exists())

    def test_invalid_description_rejected_without_writing(self):
        success, error = add_or_update_feature(
            self.ctx, "llm-chat", "HEAD", "adds chat"
        )
        self.assertFalse(success)
        self.assertIn("must start with", error)
        self.assertFalse(self.ctx.get_features_yaml_path().exists())

    def test_commit_with_no_changes_rejected(self):
        commit = self.chromium.commit_all("empty", allow_empty=True)
        success, error = add_or_update_feature(
            self.ctx, "llm-chat", commit, "feat: chat"
        )
        self.assertFalse(success)
        self.assertIn("No changed files", error)

    def test_creates_new_feature_with_sorted_files(self):
        self.chromium.add_file("chrome/browser/b_second.cc", "b")
        self.chromium.add_file("chrome/browser/a_first.cc", "a")
        commit = self.chromium.commit_all("add chat files")

        success, error = add_or_update_feature(
            self.ctx, "llm-chat", commit, "feat: LLM chat"
        )

        self.assertTrue(success, error)
        features = self._load_features()
        self.assertEqual(
            features["llm-chat"]["files"],
            ["chrome/browser/a_first.cc", "chrome/browser/b_second.cc"],
        )
        self.assertEqual(features["llm-chat"]["description"], "feat: LLM chat")

    def test_updates_existing_feature_by_merging_files(self):
        self.chromium.add_file("chrome/browser/a_first.cc", "a")
        first = self.chromium.commit_all("first")
        add_or_update_feature(self.ctx, "llm-chat", first, "feat: LLM chat")

        self.chromium.add_file("chrome/browser/a_first.cc", "a modified")
        self.chromium.add_file("chrome/browser/c_third.cc", "c")
        second = self.chromium.commit_all("second")

        success, error = add_or_update_feature(
            self.ctx, "llm-chat", second, "feat: LLM chat v2"
        )

        self.assertTrue(success, error)
        features = self._load_features()
        self.assertEqual(
            features["llm-chat"]["files"],
            ["chrome/browser/a_first.cc", "chrome/browser/c_third.cc"],
        )
        self.assertEqual(features["llm-chat"]["description"], "feat: LLM chat v2")

    def test_other_features_preserved_on_update(self):
        self.chromium.add_file("chrome/browser/a.cc", "a")
        first = self.chromium.commit_all("first")
        add_or_update_feature(self.ctx, "feature-one", first, "feat: one")

        self.chromium.add_file("chrome/browser/b.cc", "b")
        second = self.chromium.commit_all("second")
        add_or_update_feature(self.ctx, "feature-two", second, "feat: two")

        features = self._load_features()
        self.assertEqual(features["feature-one"]["files"], ["chrome/browser/a.cc"])
        self.assertEqual(features["feature-two"]["files"], ["chrome/browser/b.cc"])


if __name__ == "__main__":
    unittest.main()
