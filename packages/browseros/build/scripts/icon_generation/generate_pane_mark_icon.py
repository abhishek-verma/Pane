#!/usr/bin/env python3
"""Generate components/vector_icons/pane_mark.icon from docs/logo/pane-mark.svg.

Chromium vector icons use FILL_RULE_NONZERO. Cutouts must be a second contour in
the same subpath via R_MOVE_TO (see ads.icon), with opposite winding from the outer
shape. Geometry is scaled to CANVAS_DIMENSIONS 960 to match other vector icons.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

CANVAS = 960
# Match pane-extension-icon.svg: translate(18%) + scale(0.64) inside 100×100.
PADDING_PERCENT = 18
MARK_SCALE = 0.64
# pane-mark.svg path: outer 100×100, inner cutout 24×24 at (66, 66).
CUTOUT_ORIGIN = 66
CUTOUT_SIZE = 24


def scale(value: float) -> int:
    return round(value / 100 * CANVAS)


def mark_point(x: float, y: float) -> tuple[int, int]:
    """Map mark coordinates into the padded icon canvas."""
    padding = scale(PADDING_PERCENT)
    mark_canvas = round(CANVAS * MARK_SCALE)
    unit = mark_canvas / 100
    return (padding + round(x * unit), padding + round(y * unit))


def generate_icon_text() -> str:
    padding = scale(PADDING_PERCENT)
    mark_size = round(CANVAS * MARK_SCALE)
    cutout_x, cutout_y = mark_point(CUTOUT_ORIGIN, CUTOUT_ORIGIN)
    cutout_w = mark_point(CUTOUT_SIZE, 0)[0] - padding
    cutout_h = mark_point(0, CUTOUT_SIZE)[1] - padding

    lines = [
        "// Copyright 2026 The Chromium Authors",
        "// Use of this source code is governed by a BSD-style license that can be",
        "// found in the LICENSE file.",
        "//",
        "// Generated from docs/logo/pane-mark.svg — do not edit by hand.",
        f"// Inset: {PADDING_PERCENT}% padding, {int(MARK_SCALE * 100)}% mark scale.",
        "",
        f"CANVAS_DIMENSIONS, {CANVAS},",
        "FILL_RULE_NONZERO,",
        f"MOVE_TO, {padding}, {padding},",
        f"R_LINE_TO, {mark_size}, 0,",
        f"R_LINE_TO, 0, {mark_size},",
        f"R_LINE_TO, -{mark_size}, 0,",
        "CLOSE,",
        f"R_MOVE_TO, {cutout_x - padding}, {cutout_y - padding},",
        f"R_LINE_TO, 0, {cutout_h},",
        f"R_LINE_TO, {cutout_w}, 0,",
        f"R_LINE_TO, 0, -{cutout_h},",
        "CLOSE,",
    ]
    return "\n".join(lines) + "\n"


def verify_source_svg(svg_path: Path) -> None:
    text = svg_path.read_text(encoding="utf-8")
    expected = "M0 0h100v100H0V0zm66 66h24v24H66V66z"
    if expected not in text.replace(" ", ""):
        # Allow whitespace differences.
        compact = re.sub(r"\s+", "", text)
        if expected.replace(" ", "") not in compact:
            raise SystemExit(
                f"{svg_path} path geometry changed; update CUTOUT_* constants "
                "in generate_pane_mark_icon.py before regenerating."
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    repo_root = Path(__file__).resolve().parents[5]
    default_svg = repo_root / "docs" / "logo" / "pane-mark.svg"
    default_out = (
        repo_root
        / "packages"
        / "browseros"
        / "chromium_patches"
        / "components"
        / "vector_icons"
        / "pane_mark.icon"
    )
    parser.add_argument("--svg", type=Path, default=default_svg)
    parser.add_argument("--out", type=Path, default=default_out)
    parser.add_argument(
        "--chromium-src",
        type=Path,
        default=None,
        help="Also write to chromium src (e.g. ~/chromium/src/components/vector_icons/pane_mark.icon)",
    )
    args = parser.parse_args()

    verify_source_svg(args.svg)
    icon_text = generate_icon_text()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(icon_text, encoding="utf-8")
    print(f"Wrote {args.out}")

    patch_path = args.out
    if not patch_path.read_text(encoding="utf-8").startswith("diff "):
        diff_lines = [
            "diff --git a/components/vector_icons/pane_mark.icon b/components/vector_icons/pane_mark.icon",
            "new file mode 100644",
            "index 0000000000000..1111111111111",
            "--- /dev/null",
            "+++ b/components/vector_icons/pane_mark.icon",
            "@@ -0,0 +1,{} @@".format(len(icon_text.splitlines())),
        ]
        diff_lines.extend("+" + line for line in icon_text.splitlines())
        patch_path.write_text("\n".join(diff_lines) + "\n", encoding="utf-8")
        print(f"Wrote patch {patch_path}")

    if args.chromium_src:
        chromium_out = args.chromium_src / "components" / "vector_icons" / "pane_mark.icon"
        chromium_out.write_text(icon_text, encoding="utf-8")
        print(f"Wrote {chromium_out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
