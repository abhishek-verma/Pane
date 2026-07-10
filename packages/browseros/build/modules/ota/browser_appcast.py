#!/usr/bin/env python3
"""Generate signed Sparkle appcasts from GitHub browser release assets."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from ...common.context import Context
from ...common.env import EnvConfig
from ...common.pane_releases import (
    PANE_BROWSER_APPCAST_ARM64_URL,
    PANE_BROWSER_APPCAST_WIN_ARM64_URL,
    PANE_BROWSER_APPCAST_WIN_URL,
    PANE_BROWSER_APPCAST_X64_URL,
    PANE_GITHUB_REPO,
    github_release_download_url,
)
from ...common.sparkle import sparkle_sign_file
from ...common.utils import log_error, log_info, log_success, log_warning
from ..release.common import generate_appcast_item

SPARKLE_NS = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ET.register_namespace("sparkle", SPARKLE_NS)

FEED_SPECS = [
    {
        "filename": "appcast.xml",
        "link": PANE_BROWSER_APPCAST_ARM64_URL,
        "title": "Pane (macOS arm64)",
        "matcher": re.compile(r"(?i)arm64.*\.dmg$"),
        "platform": "macos",
    },
    {
        "filename": "appcast-x86_64.xml",
        "link": PANE_BROWSER_APPCAST_X64_URL,
        "title": "Pane (macOS x86_64)",
        "matcher": re.compile(r"(?i)(x86_64|x64).*\.dmg$"),
        "platform": "macos",
    },
    {
        "filename": "appcast-win.xml",
        "link": PANE_BROWSER_APPCAST_WIN_URL,
        "title": "Pane (Windows x64)",
        "matcher": re.compile(r"(?i)x64.*installer\.exe$|(?i)installer\.exe$"),
        "platform": "win",
    },
    {
        "filename": "appcast-win-arm64.xml",
        "link": PANE_BROWSER_APPCAST_WIN_ARM64_URL,
        "title": "Pane (Windows arm64)",
        "matcher": re.compile(r"(?i)arm64.*installer\.exe$"),
        "platform": "win",
    },
]


@dataclass
class ReleaseAsset:
    name: str
    url: str
    size: int


def _run_gh(args: List[str], repo: str) -> str:
    cmd = ["gh", "api", f"/repos/{repo}/releases/tags/{args[0]}", "--jq", args[1]]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.strip() or "gh api failed") from exc


def list_release_assets(repo: str, tag: str) -> List[ReleaseAsset]:
    payload = subprocess.run(
        ["gh", "api", f"/repos/{repo}/releases/tags/{tag}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    data = json.loads(payload)
    assets: List[ReleaseAsset] = []
    for asset in data.get("assets", []):
        assets.append(
            ReleaseAsset(
                name=asset["name"],
                url=asset["browser_download_url"],
                size=int(asset["size"]),
            )
        )
    return assets


def _match_asset(assets: List[ReleaseAsset], pattern: re.Pattern[str]) -> Optional[ReleaseAsset]:
    for asset in assets:
        if pattern.search(asset.name):
            return asset
    return None


def _load_metadata_asset(
    assets: List[ReleaseAsset], tag: str, repo: str
) -> Dict:
    metadata_name = "pane-browser-release-metadata.json"
    metadata_asset = next((a for a in assets if a.name == metadata_name), None)
    if metadata_asset is None:
        return {}

    encoded_tag = urllib.parse.quote(tag, safe="")
    url = github_release_download_url(tag, metadata_name)
    try:
        import urllib.request

        with urllib.request.urlopen(url, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        log_warning(f"Could not load {metadata_name}: {exc}")
        return {}


def _sign_asset(
    asset: ReleaseAsset,
    env: EnvConfig,
    metadata: Dict,
) -> Tuple[str, int]:
    cached = metadata.get("artifacts", {}).get(asset.name, {})
    signature = cached.get("sparkle_signature")
    length = cached.get("sparkle_length", asset.size)
    if signature and length:
        return signature, int(length)

    if not env.has_sparkle_key():
        raise RuntimeError(
            "SPARKLE_PRIVATE_KEY is required to sign release artifacts for appcasts"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / asset.name
        import urllib.request

        with urllib.request.urlopen(asset.url, timeout=600) as response:
            local_path.write_bytes(response.read())

        signature, length = sparkle_sign_file(local_path, env)
        if not signature:
            raise RuntimeError(f"Failed to sign {asset.name}")
        return signature, length


def _wrap_appcast(feed_title: str, feed_link: str, item_xml: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="{SPARKLE_NS}" version="2.0">
  <channel>
    <title>{feed_title}</title>
    <link>{feed_link}</link>
    <description>Pane browser updates</description>
    <language>en</language>

{item_xml}
  </channel>
</rss>
"""


def generate_browser_appcasts(
    *,
    version: str,
    tag: str,
    repo: str = PANE_GITHUB_REPO,
    package_root: Path,
    output_dir: Path,
    env: Optional[EnvConfig] = None,
) -> List[Path]:
    """Download GitHub release assets, sign them, and write appcast XML files."""
    if env is None:
        env = EnvConfig()

    assets = list_release_assets(repo, tag)
    if not assets:
        raise RuntimeError(f"No assets found on release {tag}")

    metadata = _load_metadata_asset(assets, tag, repo)
    ctx = Context(chromium_src=package_root, architecture="arm64", build_type="release")
    sparkle_version = metadata.get("sparkle_version") or ctx.get_sparkle_version()
    build_date = metadata.get("build_date") or datetime.now(timezone.utc).isoformat()

    output_dir.mkdir(parents=True, exist_ok=True)
    written: List[Path] = []

    for spec in FEED_SPECS:
        asset = _match_asset(assets, spec["matcher"])
        if asset is None:
            log_warning(f"No asset matched {spec['filename']} ({spec['matcher'].pattern})")
            continue

        signature, length = _sign_asset(asset, env, metadata)
        artifact = {
            "url": asset.url,
            "sparkle_signature": signature,
            "sparkle_length": length,
            "size": length,
        }
        item_xml = generate_appcast_item(
            artifact,
            version,
            sparkle_version,
            build_date,
            platform=spec["platform"],
        )
        # Rebrand item title/link for Pane
        item_xml = item_xml.replace("BrowserOS -", "Pane -").replace(
            "https://browseros.com",
            f"https://github.com/{repo}/releases/tag/{urllib.parse.quote(tag, safe='')}",
        )

        output_path = output_dir / spec["filename"]
        output_path.write_text(_wrap_appcast(spec["title"], spec["link"], item_xml))
        written.append(output_path)
        log_success(f"Wrote {output_path.name}")

    if not written:
        raise RuntimeError("No appcast files were generated (no matching release assets)")

    return written
