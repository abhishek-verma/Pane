#!/usr/bin/env python3
"""Bundled Extensions Module - Download and bundle extensions from CDN manifest"""

import json
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional

import requests

from ...common.context import Context
from ...common.module import CommandModule, ValidationError
from ...common.utils import log_info, log_success


class ExtensionInfo(NamedTuple):
    """Extension metadata parsed from update manifest"""

    id: str
    version: str
    codebase: str


REQUIRED_BUNDLED_EXTENSION_IDS: Dict[str, str] = {
    "adlpneommgkgeanpaekgoaolcpncohkf": "Pane bug reporter",
    "biedncddmddkpapdplhcnkhhplnfgbif": "Pane agent",
    "cmlhocfcmfhegcblpkphkcnoiglonenf": "Pane Claw app",
}

PANE_BUNDLED_EXTENSION_IDS: Dict[str, str] = {
    "biedncddmddkpapdplhcnkhhplnfgbif": "Pane agent",
}


def get_required_bundled_extension_ids() -> Dict[str, str]:
    """Pane builds bundle only the agent extension (§9.7)."""
    import os

    pane_build = os.environ.get("PANE_BUILD", "true").lower()
    if pane_build in ("1", "true", "yes"):
        return PANE_BUNDLED_EXTENSION_IDS
    return REQUIRED_BUNDLED_EXTENSION_IDS


class BundledExtensionsModule(CommandModule):
    """Download extensions from CDN manifest and create bundled_extensions.json"""

    produces = ["bundled_extensions"]
    requires = []
    description = "Download and bundle extensions from CDN update manifest"

    def validate(self, ctx: Context) -> None:
        if not ctx.chromium_src or not ctx.chromium_src.exists():
            raise ValidationError(
                f"Chromium source directory not found: {ctx.chromium_src}"
            )

    def execute(self, ctx: Context) -> None:
        log_info("\n📦 Bundling extensions from CDN manifest...")

        manifest_url = ctx.get_extensions_manifest_url()
        output_dir = self._get_output_dir(ctx)

        output_dir.mkdir(parents=True, exist_ok=True)
        log_info(f"  Output: {output_dir}")

        extensions = self._fetch_and_parse_manifest(manifest_url)
        if not extensions:
            raise RuntimeError("No extensions found in manifest")
        self._validate_required_extensions(extensions)

        log_info(f"  Found {len(extensions)} extensions in manifest")

        for ext in extensions:
            self._download_extension(ext, output_dir)

        self._generate_json(extensions, output_dir)

        # Also inject directly into the built app bundle so the repackage build
        # picks up the latest extension without requiring a manual rsync step.
        self._inject_into_app_bundle(extensions, output_dir, ctx)

        log_success(f"Bundled {len(extensions)} extensions successfully")

    def _get_output_dir(self, ctx: Context) -> Path:
        """Get the bundled extensions output directory in Chromium source"""
        return ctx.chromium_src / "chrome" / "browser" / "browseros" / "bundled_extensions"

    def _fetch_and_parse_manifest(self, url: str) -> List[ExtensionInfo]:
        """Fetch XML manifest and parse extension information"""
        log_info(f"  Fetching manifest: {url}")

        local_path = Path(url.removeprefix("file://")) if url.startswith("file://") else Path(url)
        if local_path.is_file():
            return self._parse_manifest_xml(local_path.read_text(encoding="utf-8"))

        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to fetch manifest: {e}")

        return self._parse_manifest_xml(response.text)

    def _parse_manifest_xml(self, xml_content: str) -> List[ExtensionInfo]:
        """Parse Google Update protocol XML manifest."""
        extensions = []

        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            raise RuntimeError(f"Failed to parse manifest XML: {e}")

        ns = {"gupdate": "http://www.google.com/update2/response"}

        # Try with namespace first, then without (for flexibility)
        apps = root.findall(".//gupdate:app", ns)
        if not apps:
            apps = root.findall(".//app")

        for app in apps:
            app_id = app.get("appid")
            if not app_id:
                continue

            updatecheck = app.find("gupdate:updatecheck", ns)
            if updatecheck is None:
                updatecheck = app.find("updatecheck")
            if updatecheck is None:
                continue

            version = updatecheck.get("version")
            codebase = updatecheck.get("codebase")

            if version and codebase:
                extensions.append(ExtensionInfo(
                    id=app_id,
                    version=version,
                    codebase=codebase,
                ))

        return extensions

    def _validate_required_extensions(
        self, extensions: List[ExtensionInfo]
    ) -> None:
        """Fail if the release manifest omits a required bundled extension."""
        extension_ids = {ext.id for ext in extensions}
        missing = [
            f"{name} ({extension_id})"
            for extension_id, name in get_required_bundled_extension_ids().items()
            if extension_id not in extension_ids
        ]
        if missing:
            raise RuntimeError(
                "Bundled extension manifest missing required entries: "
                + ", ".join(missing)
            )

    def _download_extension(self, ext: ExtensionInfo, output_dir: Path) -> None:
        """Download a single extension .crx file."""
        if not ext.codebase.lower().endswith(".crx"):
            raise RuntimeError(
                f"Bundled extension {ext.id} must use a .crx codebase URL (got {ext.codebase}). "
                "Pack CRX in the extension release workflow before browser builds."
            )

        dest_filename = f"{ext.id}.crx"
        dest_path = output_dir / dest_filename

        # Prefer a locally packed CRX when present (avoids flaky GitHub download
        # during incremental release builds on the same machine).
        local_crx = Path(f"/tmp/pane-agent-{ext.version}.crx")
        if local_crx.is_file():
            log_info(f"  Using local CRX {local_crx} for {ext.id} v{ext.version}")
            shutil.copy2(local_crx, dest_path)
            return

        log_info(f"  Downloading {ext.id} v{ext.version}...")

        try:
            response = requests.get(ext.codebase, stream=True, timeout=120)
            response.raise_for_status()

            total_size = int(response.headers.get("content-length", 0))
            downloaded = 0

            with open(dest_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=65536):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size:
                        percent = (downloaded / total_size * 100)
                        sys.stdout.write(
                            f"\r    {dest_filename}: {percent:.0f}%  "
                        )
                        sys.stdout.flush()

            if total_size:
                sys.stdout.write(f"\r    {dest_filename}: done ({total_size / 1024:.0f} KB)\n")
            else:
                sys.stdout.write(f"\r    {dest_filename}: done\n")
            sys.stdout.flush()

        except requests.RequestException as e:
            raise RuntimeError(f"Failed to download {ext.id}: {e}")

    def _get_app_bundle_extensions_dir(self, ctx: Context) -> Optional[Path]:
        """Resolve the browseros_extensions directory inside the built app bundle.

        Returns None when there is no built app (e.g. pure source-tree update
        without a prior compile step), so callers can skip injection gracefully.
        """
        try:
            app_path = ctx.get_app_path()
        except Exception:
            return None

        if not app_path.exists():
            return None

        fw_versions = app_path / "Contents" / "Frameworks" / "Pane Framework.framework" / "Versions"
        if not fw_versions.exists():
            return None

        versioned = sorted(
            [p for p in fw_versions.iterdir() if p.is_dir() and p.name != "Current"]
        )
        if not versioned:
            return None

        return versioned[-1] / "Resources" / "browseros_extensions"

    def _inject_into_app_bundle(
        self,
        extensions: List[ExtensionInfo],
        source_dir: Path,
        ctx: Context,
    ) -> None:
        """Copy updated extension files from the source dir into the live app bundle.

        The repackage config runs bundled_extensions → sign_macos.  Without this
        step the sign module signs whatever CRX was compiled into the app, not the
        freshly downloaded one.  This method bridges that gap so the one-shot config
        always embeds the correct version.
        """
        bundle_ext_dir = self._get_app_bundle_extensions_dir(ctx)
        if bundle_ext_dir is None:
            log_info("  ℹ️  No built app bundle found — skipping app-bundle injection")
            return

        bundle_ext_dir.mkdir(parents=True, exist_ok=True)
        log_info(f"  Injecting into app bundle: {bundle_ext_dir}")

        for src_file in source_dir.iterdir():
            if src_file.suffix in (".crx", ".json", ".xml") and src_file.is_file():
                shutil.copy2(src_file, bundle_ext_dir / src_file.name)

        log_info("  ✓ App bundle extensions injected")

    def _generate_json(self, extensions: List[ExtensionInfo], output_dir: Path) -> None:
        """Generate bundled_extensions.json"""
        json_path = output_dir / "bundled_extensions.json"

        data: Dict[str, Dict[str, str]] = {}
        for ext in extensions:
            data[ext.id] = {
                "external_crx": f"{ext.id}.crx",
                "external_version": ext.version,
            }

        with open(json_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")

        log_info(f"  Generated {json_path.name}")
