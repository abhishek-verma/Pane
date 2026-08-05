#!/usr/bin/env python3
"""Standard single-architecture build module for BrowserOS"""

import os
import sys
import tempfile
import shutil
from pathlib import Path
from typing import List, Mapping, Optional
from ...common.module import CommandModule, ValidationError
from ...common.context import Context
from ...common.utils import (
    run_command,
    log_info,
    log_success,
    log_warning,
    join_paths,
    IS_WINDOWS,
)

GB_PER_COMPILE_JOB = 4


def _windows_total_memory_gb() -> Optional[float]:
    """Total physical RAM in GB via GlobalMemoryStatusEx; None when unavailable."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_uint32),
                ("dwMemoryLoad", ctypes.c_uint32),
                ("ullTotalPhys", ctypes.c_uint64),
                ("ullAvailPhys", ctypes.c_uint64),
                ("ullTotalPageFile", ctypes.c_uint64),
                ("ullAvailPageFile", ctypes.c_uint64),
                ("ullTotalVirtual", ctypes.c_uint64),
                ("ullAvailVirtual", ctypes.c_uint64),
                ("ullAvailExtendedVirtual", ctypes.c_uint64),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return status.ullTotalPhys / (1024**3)
    except Exception:
        return None


def compute_ninja_jobs(env: Optional[Mapping[str, str]] = None) -> Optional[int]:
    """Resolve the -j value: env override, else Windows RAM cap, else None (autoninja default)."""
    if env is None:
        env = os.environ

    override = env.get("BROWSEROS_NINJA_JOBS")
    if override is not None:
        try:
            jobs = int(override)
        except ValueError:
            jobs = 0
        if jobs > 0:
            log_info(f"Ninja parallelism: -j {jobs} (BROWSEROS_NINJA_JOBS override)")
            return jobs
        log_warning(f"Ignoring invalid BROWSEROS_NINJA_JOBS={override!r}")

    if not IS_WINDOWS():
        return None

    total_gb = _windows_total_memory_gb()
    if total_gb is None:
        log_warning(
            "Could not query physical memory; using autoninja default parallelism"
        )
        return None

    # Windows has no overcommit: official+ThinLTO clang-cl jobs peak ~4 GB each,
    # and one-job-per-core exhausts commit (LLVM ERROR: out of memory).
    jobs = max(1, int(total_gb) // GB_PER_COMPILE_JOB)
    cpus = os.cpu_count()
    if cpus:
        jobs = min(jobs, cpus)
    log_info(
        f"Ninja parallelism: -j {jobs} (capped by {int(total_gb)} GB RAM / "
        f"{GB_PER_COMPILE_JOB} GB per job; override with BROWSEROS_NINJA_JOBS)"
    )
    return jobs


def autoninja_command(
    out_dir: str, targets: List[str], env: Optional[Mapping[str, str]] = None
) -> List[str]:
    """Assemble the autoninja argv with the resolved -j parallelism applied."""
    cmd = ["autoninja.bat" if IS_WINDOWS() else "autoninja", "-C", out_dir]
    jobs = compute_ninja_jobs(env)
    if jobs is not None:
        cmd += ["-j", str(jobs)]
    else:
        log_info("Ninja parallelism: autoninja default")
    return cmd + list(targets)


class CompileModule(CommandModule):
    produces = ["built_app"]
    requires = []
    description = "Build BrowserOS using autoninja"

    def validate(self, ctx: Context) -> None:
        if not ctx.chromium_src.exists():
            raise ValidationError(f"Chromium source not found: {ctx.chromium_src}")

        if not ctx.browseros_chromium_version:
            raise ValidationError("BrowserOS chromium version not set")

        args_file = ctx.get_gn_args_file()
        if not args_file.exists():
            raise ValidationError(f"Build not configured - args.gn not found: {args_file}")

    def execute(self, ctx: Context) -> None:
        log_info("\n🔨 Building BrowserOS (this will take a while)...")

        self._create_version_file(ctx)

        run_command(
            autoninja_command(ctx.out_dir, ["chrome", "chromedriver"]),
            cwd=ctx.chromium_src,
        )

        app_path = ctx.get_chromium_app_path()
        new_path = ctx.get_app_path()

        if app_path.exists() and not new_path.exists():
            shutil.move(str(app_path), str(new_path))

        ctx.artifact_registry.add("built_app", new_path)

        log_success("Build complete!")

    def _create_version_file(self, ctx: Context) -> None:
        # Write the Pane semantic version (e.g. "0.47.0.62") to
        # chrome/BROWSEROS_VERSION so that PANE_VERSION macro in
        # version_info_values.h.version picks it up at compile time.
        #
        # Do NOT overwrite chrome/VERSION — that file carries the real Chromium
        # MAJOR version (e.g. 148) which policy generation and other build
        # scripts require.  Clobbering it with MAJOR=0 breaks generate_policy_source.py.
        version_str = ctx.semantic_version if ctx.semantic_version else ctx.browseros_chromium_version
        parts = version_str.split(".")
        if len(parts) != 4:
            log_warning(f"Invalid version format: {version_str}")
            return

        # BROWSEROS_VERSION file format matches resources/BROWSEROS_VERSION
        version_content = (
            f"BROWSEROS_MAJOR={parts[0]}\n"
            f"BROWSEROS_MINOR={parts[1]}\n"
            f"BROWSEROS_BUILD={parts[2]}\n"
            f"BROWSEROS_PATCH={parts[3]}\n"
        )

        browseros_version_path = join_paths(ctx.chromium_src, "chrome", "BROWSEROS_VERSION")
        browseros_version_path.write_text(version_content)

        log_info(f"Created BROWSEROS_VERSION file: {version_str}")


def build_target(ctx: Context, target: str) -> bool:
    """Build a specific target (e.g., mini_installer)"""
    log_info(f"\n🔨 Building target: {target}")

    run_command(autoninja_command(ctx.out_dir, [target]), cwd=ctx.chromium_src)

    log_success(f"Target {target} built successfully")
    return True
