#!/usr/bin/env python3
"""Resource management module for BrowserOS build system"""

import glob
import shutil
import yaml
import subprocess
from pathlib import Path
from ...common.module import CommandModule, ValidationError
from ...common.context import Context
from ...common.utils import log_info, log_success, log_error, log_warning, get_platform


class ResourcesModule(CommandModule):
    produces = []
    requires = []
    description = "Copy resources (icons, extensions) to Chromium"

    def validate(self, ctx: Context) -> None:
        copy_config_path = ctx.get_copy_resources_config()
        if not copy_config_path.exists():
            raise ValidationError(f"Copy configuration file not found: {copy_config_path}")

    def execute(self, ctx: Context) -> None:
        log_info("\n📦 Copying resources...")
        if not copy_resources_impl(ctx, commit_each=False):
            raise RuntimeError("Failed to copy resources")
        # After updating the chromium source tree, also sync server resources
        # directly into the built app bundle so sign_macos sees consistent state.
        _inject_server_resources_into_app_bundle(ctx)


def copy_resources_impl(ctx: Context, commit_each: bool = False) -> bool:
    """Copy AI extensions and icons based on YAML configuration"""
    log_info("\n📦 Copying resources...")

    # Load copy configuration
    copy_config_path = ctx.get_copy_resources_config()
    if not copy_config_path.exists():
        log_error(f"Copy configuration file not found: {copy_config_path}")
        raise FileNotFoundError(
            f"Copy configuration file not found: {copy_config_path}"
        )

    with open(copy_config_path, "r") as f:
        config = yaml.safe_load(f)

    if "copy_operations" not in config:
        log_info("⚠️  No copy_operations defined in configuration")
        return True

    if commit_each:
        log_info(
            "📝 Git commit mode enabled - will create a commit after each resource copy"
        )

    # Process each copy operation
    for operation in config["copy_operations"]:
        name = operation.get("name", "Unnamed operation")
        source = operation["source"]
        destination = operation["destination"]
        op_type = operation.get("type", "directory")
        build_type_condition = operation.get("build_type")
        os_condition = operation.get("os")
        arch_condition = operation.get("arch")

        # Skip operation if build_type condition doesn't match
        if build_type_condition and build_type_condition != ctx.build_type:
            log_info(
                f"  ⏭️  Skipping {name} (build_type: {build_type_condition}, current: {ctx.build_type})"
            )
            continue

        # Skip operation if os condition doesn't match
        if os_condition:
            current_os = get_platform()
            if current_os not in os_condition:
                log_info(
                    f"  ⏭️  Skipping {name} (os: {os_condition}, current: {current_os})"
                )
                continue

        # Skip operation if arch condition doesn't match
        if arch_condition:
            if ctx.architecture not in arch_condition:
                log_info(
                    f"  ⏭️  Skipping {name} (arch: {arch_condition}, current: {ctx.architecture})"
                )
                continue

        # Resolve paths
        src_path = ctx.root_dir / source
        dst_base = ctx.chromium_src / destination

        log_info(f"  • {name}")

        try:
            if op_type == "directory":
                # Copy entire directory
                if src_path.exists() and src_path.is_dir():
                    dst_path = dst_base
                    dst_path.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
                    log_info(f"    ✓ Copied directory: {source} → {destination}")
                    if commit_each:
                        commit_resource_copy(
                            name, source, destination, ctx.chromium_src
                        )
                else:
                    log_warning(f"    Source directory not found: {source}")

            elif op_type == "files":
                # Copy files matching pattern
                files = glob.glob(str(ctx.root_dir / source))
                if files:
                    dst_base.mkdir(parents=True, exist_ok=True)
                    for file_path in files:
                        file_path = Path(file_path)
                        if file_path.is_file():
                            shutil.copy2(file_path, dst_base)
                    log_info(
                        f"    ✓ Copied {len(files)} files: {source} → {destination}"
                    )
                    if commit_each:
                        commit_resource_copy(
                            name, source, destination, ctx.chromium_src
                        )
                else:
                    log_warning(f"    No files found matching: {source}")

            elif op_type == "file":
                # Copy single file
                if src_path.exists() and src_path.is_file():
                    dst_base.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src_path, dst_base)
                    log_info(f"    ✓ Copied file: {source} → {destination}")
                    if commit_each:
                        commit_resource_copy(
                            name, source, destination, ctx.chromium_src
                        )
                else:
                    log_warning(f"    Source file not found: {source}")

        except Exception as e:
            log_error(f"    Error: {e}")

    log_success("Resources copied")
    return True


def _inject_server_resources_into_app_bundle(ctx: Context) -> None:
    """Mirror chromium-source server resources into the built app bundle.

    copy_resources_impl() writes to chromium_src/chrome/browser/browseros/*/resources.
    The sign guard checks that the app bundle matches those staged files — but the app
    bundle (out/Default_arm64/Pane.app) is only updated by a full compile or the manual
    rsync in the split build path.  This function bridges that gap for the one-shot
    repackage config so sign_macos always sees a consistent bundle.
    """
    try:
        app_path = ctx.get_app_path()
    except Exception:
        return
    if not app_path.exists():
        return

    from ...common.server_binaries import SERVER_BUNDLES

    for bundle in SERVER_BUNDLES:
        source = ctx.chromium_src / bundle.chromium_resources_root
        dest = app_path / bundle.macos_bundle_resources_root
        if not source.is_dir():
            continue
        dest.mkdir(parents=True, exist_ok=True)
        # Strip read-only bits from existing files so shutil.copytree can overwrite them.
        # The app bundle may have been signed (and thus locked) by a prior build run.
        if dest.exists():
            import subprocess
            subprocess.run(["chmod", "-R", "u+w", str(dest)], check=False)
        shutil.copytree(source, dest, dirs_exist_ok=True)
        log_info(f"  ✓ Synced {bundle.name} resources into app bundle")


def commit_resource_copy(
    name: str, source: str, destination: str, chromium_src: Path
) -> bool:
    """Create a git commit for the copied resource"""
    try:
        # Stage all changes
        cmd_add = ["git", "add", "-A"]
        result = subprocess.run(
            cmd_add, capture_output=True, text=True, cwd=chromium_src
        )
        if result.returncode != 0:
            log_warning(f"Failed to stage changes for resource copy: {name}")
            if result.stderr:
                log_warning(f"Error: {result.stderr}")
            return False

        # Create commit message
        commit_message = f"resource: {name.lower()}"

        # Create the commit
        cmd_commit = ["git", "commit", "-m", commit_message]
        result = subprocess.run(
            cmd_commit, capture_output=True, text=True, cwd=chromium_src
        )

        if result.returncode == 0:
            log_success(f"📝 Created commit for resource: {name}")
            return True
        else:
            log_warning(f"Failed to commit resource copy: {name}")
            if result.stderr:
                log_warning(f"Error: {result.stderr}")
            return False

    except Exception as e:
        log_warning(f"Error creating commit for resource {name}: {e}")
        return False
