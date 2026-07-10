#!/usr/bin/env python3
"""Common utilities for OTA update modules"""

import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass

from ...common.pane_releases import (
    PANE_SERVER_APPCAST_ALPHA_URL,
    PANE_SERVER_APPCAST_URL,
    github_release_download_url,
)
from ...common.utils import log_error, log_info, log_success

# Re-exported so callers (and ota/__init__.py) can get sparkle_sign_file
# from ota.common alongside the other OTA helpers.
from ...common.sparkle import sparkle_sign_file as sparkle_sign_file

# Sparkle XML namespace
SPARKLE_NS = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ET.register_namespace("sparkle", SPARKLE_NS)

SERVER_PLATFORMS = [
    {"name": "darwin_arm64", "binary": "browseros-server-darwin-arm64", "target": "darwin-arm64", "os": "macos", "arch": "arm64"},
    {"name": "darwin_x64", "binary": "browseros-server-darwin-x64", "target": "darwin-x64", "os": "macos", "arch": "x86_64"},
    {"name": "linux_arm64", "binary": "browseros-server-linux-arm64", "target": "linux-arm64", "os": "linux", "arch": "arm64"},
    {"name": "linux_x64", "binary": "browseros-server-linux-x64", "target": "linux-x64", "os": "linux", "arch": "x86_64"},
    {"name": "windows_x64", "binary": "browseros-server-windows-x64.exe", "target": "windows-x64", "os": "windows", "arch": "x86_64"},
]

APPCAST_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel>
    <title>{title}</title>
    <link>{appcast_url}</link>
    <description>BrowserOS Server binary updates</description>
    <language>en</language>

    <item>
      <sparkle:version>{version}</sparkle:version>
      <pubDate>{pub_date}</pubDate>

{enclosures}
    </item>

  </channel>
</rss>
"""

ENCLOSURE_TEMPLATE = """      <!-- {comment} -->
      <enclosure
        url="{url}"
        sparkle:os="{os}"
        sparkle:arch="{arch}"
        sparkle:edSignature="{signature}"
        length="{length}"
        type="application/zip"/>"""


@dataclass
class SignedArtifact:
    """Represents a signed artifact with Sparkle signature"""
    platform: str
    zip_path: Path
    signature: str
    length: int
    os: str
    arch: str


@dataclass
class ExistingAppcast:
    """Parsed data from an existing appcast file"""
    version: str
    pub_date: str
    artifacts: Dict[str, SignedArtifact]


def find_server_resources_dir(binaries_dir: Path, platform: dict) -> Optional[Path]:
    """Return the extracted ``resources/`` dir for a platform, or ``None``.

    ``binaries_dir`` is the temp root created by ``_download_artifacts``; each
    platform lives at ``<binaries_dir>/<target>/resources/``.
    """
    target = platform.get("target", platform["name"].replace("_", "-"))
    resources = binaries_dir / target / "resources"
    return resources if resources.is_dir() else None


def parse_existing_appcast(appcast_path: Path) -> Optional[ExistingAppcast]:
    """Parse existing appcast XML file.

    Args:
        appcast_path: Path to existing appcast XML file

    Returns:
        ExistingAppcast with version, pubDate, and artifacts, or None if parsing fails
    """
    if not appcast_path.exists():
        return None

    try:
        tree = ET.parse(appcast_path)
        root = tree.getroot()

        # Find the item element (we only support single-item appcasts)
        channel = root.find("channel")
        if channel is None:
            return None

        item = channel.find("item")
        if item is None:
            return None

        # Extract version
        version_elem = item.find(f"{{{SPARKLE_NS}}}version")
        if version_elem is None or version_elem.text is None:
            return None
        version = version_elem.text

        # Extract pubDate
        pub_date_elem = item.find("pubDate")
        pub_date = pub_date_elem.text if pub_date_elem is not None and pub_date_elem.text else ""

        # Extract enclosures
        artifacts: Dict[str, SignedArtifact] = {}
        for enclosure in item.findall("enclosure"):
            url = enclosure.get("url", "")
            os_type = enclosure.get(f"{{{SPARKLE_NS}}}os", "")
            arch = enclosure.get(f"{{{SPARKLE_NS}}}arch", "")
            signature = enclosure.get(f"{{{SPARKLE_NS}}}edSignature", "")
            length_str = enclosure.get("length", "0")

            if not all([url, os_type, arch, signature]):
                continue

            # Extract platform from URL (e.g., browseros_server_0.0.37_darwin_arm64.zip)
            filename = url.split("/")[-1]
            # Match pattern like _darwin_arm64.zip or _windows_x64.zip
            platform_match = re.search(r"_([a-z]+_[a-z0-9]+)\.zip$", filename)
            if not platform_match:
                continue

            platform = platform_match.group(1)
            artifacts[platform] = SignedArtifact(
                platform=platform,
                zip_path=Path(filename),
                signature=signature,
                length=int(length_str),
                os=os_type,
                arch=arch,
            )

        return ExistingAppcast(version=version, pub_date=pub_date, artifacts=artifacts)

    except ET.ParseError as e:
        log_error(f"Malformed appcast XML: {e}")
        return None
    except Exception as e:
        log_error(f"Failed to parse existing appcast: {e}")
        return None


def generate_server_appcast(
    version: str,
    artifacts: List[SignedArtifact],
    channel: str = "alpha",
    existing: Optional[ExistingAppcast] = None,
) -> str:
    """Generate appcast XML for server OTA, merging with existing if same version.

    Args:
        version: Version string (e.g., "0.0.36")
        artifacts: List of new SignedArtifact with signature info
        channel: "alpha" or "prod"
        existing: Previously parsed appcast to merge with (if same version)

    Returns:
        Complete appcast XML string

    Merge behavior:
        - If existing has same version: merge platforms, keep original pubDate
        - If existing has different version or is None: use only new artifacts
    """
    if channel == "alpha":
        title = "Pane Server (Alpha)"
        appcast_url = PANE_SERVER_APPCAST_ALPHA_URL
    else:
        title = "Pane Server"
        appcast_url = PANE_SERVER_APPCAST_URL

    # Determine pubDate and merged artifacts
    if existing is not None and existing.version == version:
        # Same version: merge artifacts, keep original pubDate
        pub_date = existing.pub_date
        merged_artifacts = dict(existing.artifacts)  # Copy existing
        for artifact in artifacts:
            merged_artifacts[artifact.platform] = artifact  # New overrides existing
        final_artifacts = list(merged_artifacts.values())
        log_info(f"Merging with existing appcast (kept {len(existing.artifacts)} existing, added/updated {len(artifacts)} platforms)")
    else:
        # Different version or no existing: start fresh
        pub_date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
        final_artifacts = artifacts
        if existing is not None:
            log_info(f"Version changed ({existing.version} -> {version}), replacing appcast")

    # Sort artifacts by platform name for consistent output
    final_artifacts = sorted(final_artifacts, key=lambda a: a.platform)

    enclosures = []
    for artifact in final_artifacts:
        comment = f"{artifact.os.capitalize()} {artifact.arch}"
        if artifact.os == "macos":
            comment = f"macOS {artifact.arch}"

        zip_filename = f"browseros_server_{version}_{artifact.platform}.zip"
        url = github_release_download_url(
            f"agent-server/v{version}",
            zip_filename,
        )

        enclosure = ENCLOSURE_TEMPLATE.format(
            comment=comment,
            url=url,
            os=artifact.os,
            arch=artifact.arch,
            signature=artifact.signature,
            length=artifact.length,
        )
        enclosures.append(enclosure)

    return APPCAST_TEMPLATE.format(
        title=title,
        appcast_url=appcast_url,
        version=version,
        pub_date=pub_date,
        enclosures="\n\n".join(enclosures),
    )


def create_server_bundle_zip(resources_dir: Path, output_zip: Path) -> bool:
    """Zip an extracted ``resources/`` tree into a Sparkle payload.

    Produces entries like ``resources/bin/browseros_server`` and
    ``resources/bin/third_party/bun`` — mirroring what the agent build
    staged and what the Chromium build bakes into the installed app.
    File modes are preserved by ``ZipFile.write`` so executable bits survive.
    """
    if not resources_dir.is_dir():
        log_error(f"Resources dir not found: {resources_dir}")
        return False

    bundle_root = resources_dir.parent
    try:
        with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(resources_dir.rglob("*")):
                if not path.is_file():
                    continue
                arcname = path.relative_to(bundle_root).as_posix()
                zf.write(path, arcname)
        log_success(f"Created {output_zip.name}")
        return True
    except Exception as e:
        log_error(f"Failed to create bundle zip: {e}")
        return False


def get_appcast_path(channel: str = "alpha") -> Path:
    """Get path to appcast file in config/appcast directory"""
    appcast_dir = Path(__file__).parent.parent.parent / "config" / "appcast"
    if channel == "alpha":
        return appcast_dir / "appcast-server.alpha.xml"
    return appcast_dir / "appcast-server.xml"
