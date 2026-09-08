#!/usr/bin/env python3
"""Shared sign metadata for bundled BrowserOS server binaries."""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class SignSpec:
    """Per-binary codesign metadata."""

    identifier_suffix: str
    options: str
    entitlements: Optional[str] = None


@dataclass(frozen=True)
class ServerBundle:
    """Resource roots and signing metadata for one bundled server."""

    name: str
    local_resources_root: Path
    chromium_resources_root: Path
    macos_bundle_resources_root: Path
    windows_bundle_resources_root: Path
    macos_binaries: Dict[str, SignSpec]
    windows_binaries: Tuple[str, ...]
    required_in_chromium_output: bool = True


BROWSEROS_SERVER_MACOS_BINARIES: Dict[str, SignSpec] = {
    "browseros_server": SignSpec(
        "browseros_server", "runtime", "browseros-executable-entitlements.plist"
    ),
    "bun": SignSpec("bun", "runtime", "browseros-executable-entitlements.plist"),
    "rg": SignSpec("rg", "runtime"),
}

BROWSEROS_CLAW_SERVER_MACOS_BINARIES: Dict[str, SignSpec] = {
    "browseros-claw-server": SignSpec(
        "browseros_claw_server",
        "runtime",
        "browseros-executable-entitlements.plist",
    ),
}


BROWSEROS_SERVER_BUNDLE = ServerBundle(
    name="BrowserOS Server",
    local_resources_root=Path("resources/binaries/browseros_server"),
    chromium_resources_root=Path("chrome/browser/browseros/server/resources"),
    macos_bundle_resources_root=Path(
        "Contents/Resources/BrowserOSServer/default/resources"
    ),
    windows_bundle_resources_root=Path("BrowserOSServer/default/resources"),
    macos_binaries=BROWSEROS_SERVER_MACOS_BINARIES,
    windows_binaries=("browseros_server.exe",),
)

BROWSEROS_CLAW_SERVER_BUNDLE = ServerBundle(
    name="BrowserOS Claw Server",
    local_resources_root=Path("resources/binaries/browseros_claw_server"),
    chromium_resources_root=Path("chrome/browser/browseros/claw_server/resources"),
    macos_bundle_resources_root=Path(
        "Contents/Resources/BrowserOSClawServer/default/resources"
    ),
    windows_bundle_resources_root=Path("BrowserOSClawServer/default/resources"),
    macos_binaries=BROWSEROS_CLAW_SERVER_MACOS_BINARIES,
    windows_binaries=("browseros-claw-server.exe",),
    required_in_chromium_output=False,
)

SERVER_BUNDLES = (
    BROWSEROS_SERVER_BUNDLE,
    BROWSEROS_CLAW_SERVER_BUNDLE,
)

MACOS_SERVER_BINARIES: Dict[str, SignSpec] = {
    stem: spec
    for bundle in SERVER_BUNDLES
    for stem, spec in bundle.macos_binaries.items()
}

WINDOWS_SERVER_BINARIES: List[str] = list(BROWSEROS_SERVER_BUNDLE.windows_binaries)


def macos_sign_spec_for(binary_path: Path) -> Optional[SignSpec]:
    """Look up sign metadata by file stem."""
    known = MACOS_SERVER_BINARIES.get(binary_path.stem)
    if known is not None:
        return known
    if "acp-runtime" in binary_path.parts:
        return SignSpec(
            f"acp.{binary_path.stem}", "runtime",
            "browseros-executable-entitlements.plist",
        )
    return None


def expected_windows_binary_paths(server_bin_dir: Path) -> List[Path]:
    """Resolve the Windows relative-path list against a ``resources/bin`` dir."""
    return [server_bin_dir / rel for rel in WINDOWS_SERVER_BINARIES]


def expected_windows_bundle_binary_paths(build_output_dir: Path) -> List[Path]:
    """Resolve all bundled server binaries under a Chromium build output dir."""
    paths: List[Path] = []
    for bundle in SERVER_BUNDLES:
        bin_dir = build_output_dir / bundle.windows_bundle_resources_root / "bin"
        paths.extend(bin_dir / rel for rel in bundle.windows_binaries)
    return paths
