#!/usr/bin/env python3
"""Generate signed server appcasts from GitHub agent-server release assets."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from ...common.env import EnvConfig
from ...common.pane_releases import PANE_GITHUB_REPO, github_release_download_url
from ...common.sparkle import sparkle_sign_file
from ...common.utils import log_info, log_success, log_warning
from .common import generate_server_appcast, parse_existing_appcast, SignedArtifact

SERVER_ZIP_PATTERN = re.compile(
    r"^browseros-server-resources-(?P<target>darwin-arm64|darwin-x64|linux-arm64|linux-x64|windows-x64)\.zip$"
)

PLATFORM_MAP = {
    "darwin-arm64": ("macos", "arm64", "darwin_arm64"),
    "darwin-x64": ("macos", "x86_64", "darwin_x64"),
    "linux-arm64": ("linux", "arm64", "linux_arm64"),
    "linux-x64": ("linux", "x86_64", "linux_x64"),
    "windows-x64": ("windows", "x86_64", "windows_x64"),
}


def _list_release_assets(repo: str, tag: str) -> List[Dict]:
    payload = subprocess.run(
        ["gh", "api", f"/repos/{repo}/releases/tags/{tag}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(payload).get("assets", [])


def generate_server_appcasts_from_github(
    *,
    version: str,
    tag: str,
    repo: str = PANE_GITHUB_REPO,
    channel: str = "prod",
    output_dir: Optional[Path] = None,
    env: Optional[EnvConfig] = None,
) -> Path:
    if env is None:
        env = EnvConfig()
    if not env.has_sparkle_key():
        raise RuntimeError("SPARKLE_PRIVATE_KEY is required to sign server OTA artifacts")

    assets = _list_release_assets(repo, tag)
    signed: List[SignedArtifact] = []

    for asset in assets:
        name = asset["name"]
        match = SERVER_ZIP_PATTERN.match(name)
        if not match:
            continue

        target = match.group("target")
        os_name, arch, platform_name = PLATFORM_MAP[target]
        download_url = github_release_download_url(tag, name)

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / name
            with urllib.request.urlopen(asset["browser_download_url"], timeout=600) as response:
                local_path.write_bytes(response.read())

            signature, length = sparkle_sign_file(local_path, env)
            if not signature:
                raise RuntimeError(f"Failed to sign {name}")

        signed.append(
            SignedArtifact(
                platform=platform_name,
                zip_path=Path(name),
                signature=signature,
                length=length,
                os=os_name,
                arch=arch,
            )
        )
        log_info(f"Signed {name}")

    if not signed:
        raise RuntimeError(f"No server zip assets found on release {tag}")

    if output_dir is None:
        output_dir = Path(__file__).resolve().parents[4] / ".." / ".." / "updates" / "server"
        output_dir = output_dir.resolve()

    output_dir.mkdir(parents=True, exist_ok=True)
    filename = "appcast-server.alpha.xml" if channel == "alpha" else "appcast-server.xml"
    output_path = output_dir / filename

    existing = None
    if output_path.exists():
        existing = parse_existing_appcast(output_path.read_text())

    appcast_xml = generate_server_appcast(version, signed, channel=channel, existing=existing)
    output_path.write_text(appcast_xml)
    log_success(f"Wrote {output_path}")
    return output_path
