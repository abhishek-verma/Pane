#!/usr/bin/env bash
# Apply Phase 6 captureTabAudio patches directly into an existing Chromium tree.
# Skips the full patches module (which fails when the checkout has index drift).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PATCHES="$ROOT/packages/browseros/chromium_patches"
CHROMIUM_SRC="${CHROMIUM_SRC:-/Users/abhishek/chromium/src}"

apply_new_file_patch() {
  local patch="$1"
  local dest="$2"
  python3 - <<PY
from pathlib import Path
patch = Path("$patch")
dest = Path("$dest")
lines = []
for line in patch.read_text().splitlines():
    if line.startswith("+") and not line.startswith("+++"):
        lines.append(line[1:])
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text("\n".join(lines) + ("\n" if lines else ""))
print(f"Applied {dest} ({len(lines)} lines)")
PY
}

echo "Applying capture patches to $CHROMIUM_SRC ..."

apply_new_file_patch \
  "$PATCHES/chrome/common/extensions/api/browser_os.idl" \
  "$CHROMIUM_SRC/chrome/common/extensions/api/browser_os.idl"

apply_new_file_patch \
  "$PATCHES/chrome/browser/extensions/api/browser_os/browser_os_api.h" \
  "$CHROMIUM_SRC/chrome/browser/extensions/api/browser_os/browser_os_api.h"

apply_new_file_patch \
  "$PATCHES/chrome/browser/extensions/api/browser_os/browser_os_api.cc" \
  "$CHROMIUM_SRC/chrome/browser/extensions/api/browser_os/browser_os_api.cc"

apply_new_file_patch \
  "$PATCHES/chrome/browser/extensions/api/browser_os/browser_os_capture.h" \
  "$CHROMIUM_SRC/chrome/browser/extensions/api/browser_os/browser_os_capture.h"

apply_new_file_patch \
  "$PATCHES/chrome/browser/extensions/api/browser_os/browser_os_capture.cc" \
  "$CHROMIUM_SRC/chrome/browser/extensions/api/browser_os/browser_os_capture.cc"

python3 - <<PY
import os
from pathlib import Path
import re

chromium = Path(os.environ.get("CHROMIUM_SRC", "/Users/abhishek/chromium/src"))
if not chromium.exists():
    raise SystemExit("CHROMIUM_SRC missing")

# BUILD.gn: add capture sources if missing.
build_gn = chromium / "chrome/browser/extensions/BUILD.gn"
text = build_gn.read_text()
needle = '      "api/browser_os/browser_os_api.h",\n'
insert = needle + (
    '      "api/browser_os/browser_os_capture.cc",\n'
    '      "api/browser_os/browser_os_capture.h",\n'
)
if "browser_os_capture.cc" not in text:
    if needle not in text:
        raise SystemExit("BUILD.gn anchor not found")
    build_gn.write_text(text.replace(needle, insert, 1))
    print("Updated chrome/browser/extensions/BUILD.gn")
else:
    print("BUILD.gn already has browser_os_capture")

# Histogram enum values.
hist = chromium / "extensions/browser/extension_function_histogram_value.h"
ht = hist.read_text()
if "BROWSER_OS_CAPTURETABAUDIO" not in ht:
    ht = ht.replace(
        "  BROWSER_OS_SHOWINFOBAR = 1988,\n",
        "  BROWSER_OS_SHOWINFOBAR = 1988,\n"
        "  BROWSER_OS_CAPTURETABAUDIO = 1989,\n"
        "  BROWSER_OS_STOPCAPTURETABAUDIO = 1990,\n"
        "  BROWSER_OS_GETCAPTURESTATUS = 1991,\n",
        1,
    )
    hist.write_text(ht)
    print("Updated extension_function_histogram_value.h")
else:
    print("Histogram header already updated")

# enums.xml for metrics.
enums = chromium / "tools/metrics/histograms/metadata/extensions/enums.xml"
et = enums.read_text()
if "BROWSER_OS_CAPTURETABAUDIO" not in et:
    et = et.replace(
        '  <int value="1988" label="BROWSER_OS_SHOWINFOBAR"/>\n',
        '  <int value="1988" label="BROWSER_OS_SHOWINFOBAR"/>\n'
        '  <int value="1989" label="BROWSER_OS_CAPTURETABAUDIO"/>\n'
        '  <int value="1990" label="BROWSER_OS_STOPCAPTURETABAUDIO"/>\n'
        '  <int value="1991" label="BROWSER_OS_GETCAPTURESTATUS"/>\n',
        1,
    )
    enums.write_text(et)
    print("Updated extensions/enums.xml")
else:
    print("enums.xml already updated")

print("Capture patches applied.")
PY
