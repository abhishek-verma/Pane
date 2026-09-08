from pathlib import Path
import tempfile
import unittest

from .context import Context


class ReleaseVersionTest(unittest.TestCase):
    def test_canonical_pane_version_wins_over_stale_legacy_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / "resources"
            resources.mkdir()
            prefix = "BROWSEROS_MAJOR=0\nBROWSEROS_MINOR=47\nBROWSEROS_BUILD=0\n"
            (resources / "BROWSEROS_VERSION").write_text(prefix + "BROWSEROS_PATCH=87\n")
            (resources / "PANE_VERSION").write_text(prefix + "BROWSEROS_PATCH=88\n")
            self.assertEqual(Context._load_semantic_version(root), "0.47.0.88")

    def test_legacy_fork_without_pane_version_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "resources").mkdir()
            (root / "resources/BROWSEROS_VERSION").write_text("BROWSEROS_MAJOR=0\nBROWSEROS_MINOR=31\nBROWSEROS_BUILD=0\nBROWSEROS_PATCH=1\n")
            self.assertEqual(Context._load_semantic_version(root), "0.31.0.1")
