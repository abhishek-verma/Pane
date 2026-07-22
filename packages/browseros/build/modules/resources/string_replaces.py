#!/usr/bin/env python3
"""String replacement module for BrowserOS build system"""

import re
from ...common.module import CommandModule, ValidationError
from ...common.context import Context
from ...common.utils import log_info, log_success, log_error, log_warning


class StringReplacesModule(CommandModule):
    produces = []
    requires = []
    description = "Apply branding string replacements in Chromium"

    def validate(self, ctx: Context) -> None:
        if not ctx.chromium_src.exists():
            raise ValidationError(f"Chromium source not found: {ctx.chromium_src}")

    def execute(self, ctx: Context) -> None:
        log_info("\n🔤 Applying string replacements...")
        if not apply_string_replacements_impl(ctx):
            raise RuntimeError("Failed to apply string replacements")


# Strings we want to replace but that we also replace automatically
# for XTB files
branding_replacements = [
    (
        r"The Chromium Authors. All rights reserved.",
        r"Pane. All rights reserved.",
    ),
    (
        r"Google LLC. All rights reserved.",
        r"Pane. All rights reserved.",
    ),
    (r"The Chromium Authors", r"Pane"),
    (r"Google Chrome", r"Pane"),
    (r"(Google)(?! Play)", r"Pane"),
    (r"Chromium", r"Pane"),
    (r"Assistant", r"Pane"),
    (r"BrowserOS Feedback", r"Pane Feedback"),
    (r"BrowserOS", r"Pane"),
    (r"Chrome", r"Pane"),
]

# List of files to apply replacements to
target_files = [
    "chrome/app/chromium_strings.grd",
    "chrome/app/settings_chromium_strings.grdp",
    "chrome/app/generated_resources.grd",
]


def _replace_outside_name_attrs(content: str, pattern: str, replacement: str) -> tuple[str, int]:
    """Apply a regex replace, but never rewrite XML name="..." attributes.

    Branding rules like Chrome→Pane must not rename grit IDs such as
    IDS_IMPORT_FROM_CHROME (C++ still references the original identifier).
    """
    parts = re.split(r'(name="[^"]*")', content)
    matches = 0
    out: list[str] = []
    for part in parts:
        if part.startswith('name="'):
            out.append(part)
            continue
        found = len(re.findall(pattern, part))
        if found:
            part = re.sub(pattern, replacement, part)
            matches += found
        out.append(part)
    return "".join(out), matches


def apply_string_replacements_impl(ctx: Context) -> bool:
    """Internal implementation for applying string replacements"""

    success = True

    for file_path in target_files:
        full_path = ctx.chromium_src / file_path

        if not full_path.exists():
            log_warning(f"  ⚠️  File not found: {file_path}")
            continue

        log_info(f"  • Processing: {file_path}")

        try:
            # Read the file content
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read()

            original_content = content
            replacement_count = 0

            # Apply each replacement
            for pattern, replacement in branding_replacements:
                content, matches = _replace_outside_name_attrs(
                    content, pattern, replacement
                )
                if matches > 0:
                    replacement_count += matches
                    log_info(f"    ✓ Replaced {matches} occurrences of '{pattern}'")

            # Importer source label must stay "Google Chrome" (user imports FROM
            # Chrome into Pane). Branding passes above would otherwise rewrite it.
            restored = re.sub(
                r'(<message name="IDS_IMPORT_FROM_CHROME"[^>]*>)\s*Pane\s*(</message>)',
                r"\1\n          Google Chrome\n        \2",
                content,
            )
            if restored != content:
                content = restored
                log_info('    ✓ Restored IDS_IMPORT_FROM_CHROME label to "Google Chrome"')

            # Write back if changes were made
            if content != original_content:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(content)
                log_success(f"    Updated with {replacement_count} total replacements")
            else:
                log_info("    No replacements needed")

        except Exception as e:
            log_error(f"    Error processing {file_path}: {e}")
            success = False

    if success:
        log_success("String replacements completed")
    else:
        log_error("String replacements failed")

    return success
