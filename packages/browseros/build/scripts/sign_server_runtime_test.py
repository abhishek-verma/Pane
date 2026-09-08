"""Standalone resources must have a complete, contained native-code closure."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .sign_server_runtime import native_files, sign_resources


class ServerRuntimeSigningTest(unittest.TestCase):
    def test_discovers_native_code_without_filename_allowlist(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "future-provider"
            executable.write_bytes(b"\xcf\xfa\xed\xfe" + b"\0" * 32)
            (root / "script.js").write_text("console.log('test')")
            (root / "alias").symlink_to(executable)
            self.assertEqual(native_files(root), [executable.resolve()])

    def test_rejects_symlinks_to_outside_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "resources"
            root.mkdir()
            (root / "escape").symlink_to(Path(directory), target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "escapes"):
                native_files(root)

    def test_refuses_unsigned_standalone_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "resources"
            (root / "acp-runtime").mkdir(parents=True)
            (root / "acp-runtime/runtime.json").write_text("{}")
            with patch("build.scripts.sign_server_runtime.check_environment", return_value=(False, {})):
                with self.assertRaisesRegex(RuntimeError, "no unsigned upload"):
                    sign_resources(root)


if __name__ == "__main__":
    unittest.main()
