"""Sign and notarize standalone server resources BEFORE any OTA upload.

Browser CI resource builds are sealed by the app signing pipeline instead.
Standalone executable ZIPs cannot be stapled; Apple's acceptance registers
the signed code hashes for Gatekeeper. Never ship an unsigned fallback.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from ..common.env import EnvConfig
from ..modules.sign.macos import (
    _cleanup_notary_temp_files,
    check_environment,
    get_browseros_server_binary_info,
    get_identifier_for_component,
    import_developer_id_certificate,
    is_macho_file,
    materialize_notary_auth,
    notarytool_auth_args,
    sign_component,
    unlock_keychain,
)


def native_files(root: Path) -> list[Path]:
    root = root.resolve()
    found = set()
    for path in root.rglob("*"):
        if path.is_symlink() and not path.resolve().is_relative_to(root):
            raise RuntimeError(f"Resource symlink escapes its bundle: {path}")
        if not path.is_file():
            continue
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            raise RuntimeError(f"Resource symlink escapes its bundle: {path}")
        if is_macho_file(resolved):
            found.add(resolved)
    return sorted(found)


def sign_resources(root: Path) -> None:
    root = root.resolve()
    if root.name != "resources" or not (root / "acp-runtime/runtime.json").is_file():
        raise RuntimeError("Expected staged server resources with an ACP runtime manifest")
    env = EnvConfig()
    valid, config = check_environment(env)
    if not valid:
        raise RuntimeError("Standalone macOS server releases require Developer ID and notarization credentials; no unsigned upload is allowed")
    import_developer_id_certificate(env)
    unlock_keychain(env)
    components = native_files(root)
    entitlements_root = Path(__file__).resolve().parents[2] / "resources/entitlements"
    if not (entitlements_root / "browseros-executable-entitlements.plist").is_file():
        raise RuntimeError("Missing server executable entitlements")
    for path in components:
        library = path.suffix in {".node", ".dylib", ".so"}
        info = get_browseros_server_binary_info(path) or {}
        entitlements = entitlements_root / info["entitlements"] if not library and info.get("entitlements") else None
        if not sign_component(path, config["certificate_name"], get_identifier_for_component(path), "" if library else "runtime", entitlements):
            raise RuntimeError(f"Signing failed: {path}")
        subprocess.run(["codesign", "--verify", "--strict", str(path)], check=True, capture_output=True)
    auth = materialize_notary_auth(config)
    try:
        with tempfile.TemporaryDirectory(prefix="pane-server-notary-") as temporary:
            archive = Path(temporary) / "server.zip"
            subprocess.run(["ditto", "-c", "-k", "--keepParent", str(root), str(archive)], check=True)
            # Keep auth arguments out of logs and exceptions.
            result = subprocess.run(["xcrun", "notarytool", "submit", str(archive), *notarytool_auth_args(auth), "--wait", "--output-format", "json"], capture_output=True, text=True)
            try:
                report = json.loads(result.stdout)
            except ValueError:
                raise RuntimeError("Notarization did not return a valid report") from None
            if result.returncode or report.get("status") != "Accepted":
                raise RuntimeError(f"Server notarization failed: {report.get('status')} (submission {report.get('id')})")
            print(f"Signed and notarized {len(components)} native server components; submission {report.get('id')}")
    finally:
        _cleanup_notary_temp_files(auth)


if __name__ == "__main__":
    sign_resources(Path(sys.argv[1]))
